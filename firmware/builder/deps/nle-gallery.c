/*
 * nle-gallery: Interactive photo gallery for Nest Gen 2 LCD
 *
 * Horizontal carousel driven by rotary ring input.
 * - Ring rotation scrubs images left/right in real-time
 * - Past midpoint: snaps to next/prev with ease-out
 * - Auto-advances when idle (10s)
 * - Display sleeps after 5 min, wakes on ring turn or button press
 * - Peek mode: motion detection shows one photo for 10s, ring activates full gallery
 * - Click sound via PWM beeper on transitions
 * - Lazy-loads images: 7-image sliding cache (current + 3 ahead + 3 behind)
 *
 * Uses fork() for blocking input reads + write() for framebuffer.
 * Integer-only math (no FPU required).
 * Targets kernel 2.6.37 ARMv7.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <sys/select.h>
#include <signal.h>
#include <stdint.h>
#include <errno.h>
#include <sys/wait.h>
#include <time.h>
#include <sys/time.h>
#include <dirent.h>
#include <sys/file.h>

#define WIDTH      320
#define HEIGHT     320
#define BPP        4
#define STRIDE     (WIDTH * BPP)
#define IMG_SIZE   (WIDTH * HEIGHT * BPP)
#define MAX_PHOTOS 99

/* OMAPFB ioctl for atomic display update */
#define OMAP_IOW(num, dtype) _IOW('O', num, dtype)
struct omapfb_update_window {
    uint32_t x, y;
    uint32_t width, height;
    uint32_t format;
    uint32_t out_x, out_y;
    uint32_t out_width, out_height;
    uint32_t reserved[8];
};
#define OMAPFB_UPDATE_WINDOW OMAP_IOW(54, struct omapfb_update_window)

#define RING_SCALE      10
#define SNAP_FRAMES     12
#define SNAP_DELAY_US   16000
#define AUTO_LOOPS      200    /* 200 * 50ms = 10s */
#define RING_IDLE_LOOPS 3      /* 3 * 50ms = 150ms */
#define SLEEP_LOOPS     6000   /* 6000 * 50ms = 5 min */
#define PEEK_LOOPS      200    /* 200 * 50ms = 10s */
#define MOTION_POLL     10     /* check backlight every 10 loops = 500ms */

/* Image cache: 7 buffers = current + 3 ahead + 3 behind (~2.8 MB) */
#define CACHE_SIZE  7
#define CACHE_AHEAD 3

/* 32-bit ARM kernel 2.6.37 input_event: 16 bytes */
struct my_input_event {
    uint32_t tv_sec;
    uint32_t tv_usec;
    uint16_t type;
    uint16_t code;
    int32_t  value;
} __attribute__((packed));

#define EV_KEY   0x01
#define EV_REL   0x02
#define EV_SND   0x12
#define SND_BELL 0x01
#define SND_TONE 0x02

/* Message types from child to parent via pipe */
#define MSG_RING   'R'   /* ring rotation, followed by int8_t value */
#define MSG_BUTTON 'B'   /* button press */

/* Photo path list (just filenames, not image data) */
static char photo_paths[MAX_PHOTOS][256];
static int num_photos = 0;
static int current_idx = 0;
static int offset = 0;

/* Sliding image cache */
static unsigned char *cache_buf[CACHE_SIZE];
static int cache_photo[CACHE_SIZE];  /* which photo index is in each slot, -1 = empty */

static unsigned char *frame_buf;
static int fb_fd = -1;
static volatile int running = 1;
static pid_t child_pid = 0;
static int display_on = 1;
static int peek_mode = 0;      /* 1 = showing single photo after motion detect */
static int gallery_paused = 0;
static uint32_t last_button_sec = 0;
static uint32_t last_button_usec = 0;

#define DCLICK_MS 400  /* max ms between clicks for double-click */

static void sighandler(int sig) {
    (void)sig;
    running = 0;
}

static void crashhandler(int sig) {
    const char *name = "UNKNOWN";
    switch(sig) {
        case 4: name = "SIGILL"; break;
        case 6: name = "SIGABRT"; break;
        case 7: name = "SIGBUS"; break;
        case 8: name = "SIGFPE"; break;
        case 11: name = "SIGSEGV"; break;
    }
    write(2, "CRASH: ", 7);
    write(2, name, strlen(name));
    write(2, "\n", 1);
    _exit(128 + sig);
}

/* Load a single image from disk into an existing buffer */
static int load_image_into(unsigned char *buf, const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) {
        memset(buf, 0, IMG_SIZE);  /* black on failure */
        return -1;
    }
    if (fread(buf, 1, IMG_SIZE, f) != IMG_SIZE) {
        memset(buf, 0, IMG_SIZE);
        fclose(f);
        return -1;
    }
    fclose(f);
    return 0;
}

/* Get photo data by index — returns cached buffer, loading from disk if needed */
static unsigned char *get_photo(int photo_idx) {
    /* Already cached? */
    int i;
    for (i = 0; i < CACHE_SIZE; i++) {
        if (cache_photo[i] == photo_idx)
            return cache_buf[i];
    }

    /* Find slot to evict: prefer empty, then furthest from current_idx */
    int best_slot = 0;
    int best_dist = -1;
    for (i = 0; i < CACHE_SIZE; i++) {
        if (cache_photo[i] < 0) {
            best_slot = i;
            break;
        }
        int d1 = (cache_photo[i] - current_idx + num_photos) % num_photos;
        int d2 = (current_idx - cache_photo[i] + num_photos) % num_photos;
        int dist = d1 < d2 ? d1 : d2;
        if (dist > best_dist) {
            best_dist = dist;
            best_slot = i;
        }
    }

    load_image_into(cache_buf[best_slot], photo_paths[photo_idx]);
    cache_photo[best_slot] = photo_idx;
    return cache_buf[best_slot];
}

/* Preload cache around current position */
static void cache_preload(void) {
    int d;
    get_photo(current_idx);
    for (d = 1; d <= CACHE_AHEAD && d < num_photos; d++) {
        get_photo((current_idx + d) % num_photos);
        get_photo((current_idx - d + num_photos) % num_photos);
    }
}

/* Invalidate all cache entries */
static void cache_invalidate(void) {
    int i;
    for (i = 0; i < CACHE_SIZE; i++)
        cache_photo[i] = -1;
}

static void shuffle_photos(void) {
    unsigned int seed = (unsigned int)time(NULL);
    int i;
    for (i = num_photos - 1; i > 0; i--) {
        seed = seed * 1103515245 + 12345;
        int j = (seed >> 16) % (i + 1);
        char tmp[256];
        strcpy(tmp, photo_paths[i]);
        strcpy(photo_paths[i], photo_paths[j]);
        strcpy(photo_paths[j], tmp);
    }
}

static int cmp_strings(const void *a, const void *b) {
    return strcmp((const char *)a, (const char *)b);
}

static void load_photos(const char *photo_dir) {
    num_photos = 0;
    DIR *dir = opendir(photo_dir);
    if (!dir) return;

    struct dirent *ent;
    while ((ent = readdir(dir)) != NULL) {
        if (num_photos >= MAX_PHOTOS) break;
        const char *name = ent->d_name;
        size_t len = strlen(name);
        /* Must end with .raw and be at least 5 chars (x.raw) */
        if (len < 5 || strcmp(name + len - 4, ".raw") != 0)
            continue;
        /* Build full path and check file size */
        char path[256];
        snprintf(path, sizeof(path), "%s/%s", photo_dir, name);
        FILE *f = fopen(path, "rb");
        if (!f) continue;
        fseek(f, 0, SEEK_END);
        long sz = ftell(f);
        fclose(f);
        if (sz != IMG_SIZE) continue;
        strcpy(photo_paths[num_photos], path);
        num_photos++;
    }
    closedir(dir);

    /* Sort alphabetically for consistent order before shuffle */
    if (num_photos > 1)
        qsort(photo_paths, num_photos, sizeof(photo_paths[0]), cmp_strings);

    shuffle_photos();
    if (num_photos > 0) {
        if (current_idx >= num_photos) current_idx = 0;
        cache_invalidate();
        cache_preload();
    }
}

static pid_t update_pid = 0;

static void start_update(void) {
    if (update_pid > 0) return;  /* already running */
    pid_t pid = fork();
    if (pid == 0) {
        execl("/bin/sh", "sh", "-c",
              "/usr/bin/nle-gallery-update >/dev/null 2>&1",
              (char *)NULL);
        _exit(1);
    } else if (pid > 0) {
        update_pid = pid;
    }
}

/* Returns 1 if update just finished, 0 otherwise */
static int check_update_done(void) {
    if (update_pid <= 0) return 0;
    int status;
    int w = waitpid(update_pid, &status, WNOHANG);
    if (w > 0) {
        update_pid = 0;
        return 1;
    }
    return 0;
}

static void fb_write(void) {
    lseek(fb_fd, 0, SEEK_SET);
    write(fb_fd, frame_buf, IMG_SIZE);
    write(fb_fd, frame_buf, IMG_SIZE);
    /* Tell display controller to refresh from buffer */
    struct omapfb_update_window uw;
    memset(&uw, 0, sizeof(uw));
    uw.x = 0;
    uw.y = 0;
    uw.width = WIDTH;
    uw.height = HEIGHT;
    uw.out_x = 0;
    uw.out_y = 0;
    uw.out_width = WIDTH;
    uw.out_height = HEIGHT;
    ioctl(fb_fd, OMAPFB_UPDATE_WINDOW, &uw);
}

static void render(void) {
    int abs_off = offset < 0 ? -offset : offset;
    if (abs_off > WIDTH) abs_off = WIDTH;

    unsigned char *cur_img = get_photo(current_idx);

    if (abs_off == 0) {
        memcpy(frame_buf, cur_img, IMG_SIZE);
        fb_write();
        return;
    }

    int next_idx;
    if (offset > 0)
        next_idx = (current_idx + 1) % num_photos;
    else
        next_idx = (current_idx - 1 + num_photos) % num_photos;

    unsigned char *nxt_img = get_photo(next_idx);

    int row;
    for (row = 0; row < HEIGHT; row++) {
        unsigned char *dst = frame_buf + row * STRIDE;
        unsigned char *cur_row = cur_img + row * STRIDE;
        unsigned char *nxt_row = nxt_img + row * STRIDE;

        if (offset > 0) {
            memcpy(dst, cur_row + abs_off * BPP, (WIDTH - abs_off) * BPP);
            memcpy(dst + (WIDTH - abs_off) * BPP, nxt_row, abs_off * BPP);
        } else {
            memcpy(dst, nxt_row + (WIDTH - abs_off) * BPP, abs_off * BPP);
            memcpy(dst + abs_off * BPP, cur_row, (WIDTH - abs_off) * BPP);
        }
    }

    fb_write();
}

/* Integer ease-out cubic: returns [0, 1024] for input num/denom */
static int ease_out_fixed(int num, int denom) {
    int t = 1024 - (num * 1024 / denom);
    int t2 = t * t / 1024;
    int t3 = t2 * t / 1024;
    return 1024 - t3;
}

static void click(int beeper_fd) {
    if (beeper_fd < 0) return;
    struct my_input_event ev;
    memset(&ev, 0, sizeof(ev));
    ev.type = EV_SND;
    ev.code = SND_TONE;
    ev.value = 1000;
    write(beeper_fd, &ev, sizeof(ev));
    usleep(25000);
    ev.value = 0;
    write(beeper_fd, &ev, sizeof(ev));
}

static void snap_to(int target, int beeper_fd) {
    int start = offset;
    int i;
    for (i = 1; i <= SNAP_FRAMES; i++) {
        int t = ease_out_fixed(i, SNAP_FRAMES);
        offset = start + (target - start) * t / 1024;
        render();
        usleep(SNAP_DELAY_US);
    }
    offset = target;

    if (target >= WIDTH) {
        current_idx = (current_idx + 1) % num_photos;
        offset = 0;
        click(beeper_fd);
        cache_preload();  /* warm cache around new position */
    } else if (target <= -WIDTH) {
        current_idx = (current_idx - 1 + num_photos) % num_photos;
        offset = 0;
        click(beeper_fd);
        cache_preload();
    }

    render();
}

/* Forward declarations for display takeover (defined after find_pid) */
static void takeover_display(void);
static void release_display(void);

/* Check if backlight is on (nlclient woke display for motion/proximity) */
static int backlight_is_on(void) {
    char buf[16];
    int fd = open("/sys/class/backlight/3-0036/brightness", O_RDONLY);
    if (fd < 0) return 0;
    ssize_t n = read(fd, buf, sizeof(buf) - 1);
    close(fd);
    if (n <= 0) return 0;
    buf[n] = 0;
    return atoi(buf) > 0;
}

static void display_sleep(int do_takeover) {
    if (!display_on) return;
    display_on = 0;
    /* Blank display and turn off backlight */
    int fd = open("/sys/class/backlight/3-0036/brightness", O_WRONLY);
    if (fd >= 0) { write(fd, "0\n", 2); close(fd); }
    fd = open("/sys/class/graphics/fb0/blank", O_WRONLY);
    if (fd >= 0) { write(fd, "1\n", 2); close(fd); }
    /* Release nlclient so it can manage charging/HVAC while we sleep */
    if (do_takeover) release_display();
    fprintf(stderr, "display sleep (nlclient released)\n");
    fflush(stderr);
}

static void display_wake(int do_takeover) {
    if (display_on) return;
    display_on = 1;
    /* Re-freeze nlclient so we own the framebuffer */
    if (do_takeover) takeover_display();
    /* Redraw current image */
    offset = 0;
    render();
    fprintf(stderr, "display wake (nlclient frozen)\n");
    fflush(stderr);
}

/* Child process: reads from ring (event1) and button (event2),
 * sends typed messages to parent via pipe */
static void input_reader(int pipe_wr, const char *ring_dev) {
    int ring_fd = open(ring_dev, O_RDONLY);
    if (ring_fd < 0) {
        fprintf(stderr, "child: open %s: %s\n", ring_dev, strerror(errno));
    } else {
        fprintf(stderr, "child: ring fd=%d\n", ring_fd);
    }

    int btn_fd = open("/dev/input/event2", O_RDONLY);
    if (btn_fd < 0) {
        fprintf(stderr, "child: open event2: %s\n", strerror(errno));
    } else {
        fprintf(stderr, "child: button fd=%d\n", btn_fd);
    }

    int maxfd = 0;
    if (ring_fd > maxfd) maxfd = ring_fd;
    if (btn_fd > maxfd) maxfd = btn_fd;

    fprintf(stderr, "child: reading events\n");
    fflush(stderr);

    while (1) {
        fd_set rfds;
        FD_ZERO(&rfds);
        if (ring_fd >= 0) FD_SET(ring_fd, &rfds);
        if (btn_fd >= 0) FD_SET(btn_fd, &rfds);

        int ret = select(maxfd + 1, &rfds, NULL, NULL, NULL);
        if (ret < 0) {
            if (errno == EINTR) continue;
            break;
        }

        if (ring_fd >= 0 && FD_ISSET(ring_fd, &rfds)) {
            struct my_input_event ev;
            if (read(ring_fd, &ev, sizeof(ev)) == sizeof(ev)) {
                if (ev.type == EV_REL) {
                    char msg[2];
                    msg[0] = MSG_RING;
                    msg[1] = (int8_t)ev.value;
                    write(pipe_wr, msg, 2);
                }
            }
        }

        if (btn_fd >= 0 && FD_ISSET(btn_fd, &rfds)) {
            struct my_input_event ev;
            if (read(btn_fd, &ev, sizeof(ev)) == sizeof(ev)) {
                if (ev.type == EV_KEY && ev.value == 1) {
                    char msg = MSG_BUTTON;
                    write(pipe_wr, &msg, 1);
                }
            }
        }
    }

    if (ring_fd >= 0) close(ring_fd);
    if (btn_fd >= 0) close(btn_fd);
    _exit(0);
}

/* Find PID by process name (simple /proc scan) */
static pid_t find_pid(const char *name) {
    char path[64], buf[256];
    int i;
    for (i = 1; i < 32768; i++) {
        snprintf(path, sizeof(path), "/proc/%d/comm", i);
        int fd = open(path, O_RDONLY);
        if (fd < 0) continue;
        ssize_t n = read(fd, buf, sizeof(buf) - 1);
        close(fd);
        if (n <= 0) continue;
        buf[n] = 0;
        /* Strip trailing newline */
        if (n > 0 && buf[n-1] == '\n') buf[n-1] = 0;
        if (strcmp(buf, name) == 0) return i;
    }
    return 0;
}

/* Freeze Nest UI processes and take over display */
static void takeover_display(void) {
    pid_t hb = find_pid("nlheartbeatd");
    if (hb > 0) {
        kill(hb, SIGSTOP);
        fprintf(stderr, "Froze nlheartbeatd (pid %d)\n", hb);
    }
    pid_t nlc = find_pid("nlclient");
    if (nlc > 0) {
        kill(nlc, SIGSTOP);
        fprintf(stderr, "Froze nlclient (pid %d)\n", nlc);
    }
    /* Unblank and set backlight */
    int fd = open("/sys/class/graphics/fb0/blank", O_WRONLY);
    if (fd >= 0) { write(fd, "0\n", 2); close(fd); }
    fd = open("/sys/class/backlight/3-0036/brightness", O_WRONLY);
    if (fd >= 0) { write(fd, "120\n", 4); close(fd); }
    fprintf(stderr, "Display takeover complete\n");
}

/* Release display back to Nest UI */
static void release_display(void) {
    pid_t nlc = find_pid("nlclient");
    if (nlc > 0) {
        kill(nlc, SIGCONT);
        fprintf(stderr, "Resumed nlclient (pid %d)\n", nlc);
    }
    pid_t hb = find_pid("nlheartbeatd");
    if (hb > 0) {
        kill(hb, SIGCONT);
        fprintf(stderr, "Resumed nlheartbeatd (pid %d)\n", hb);
    }
}


int main(int argc, char *argv[]) {
    const char *photo_dir = "/tmp";
    const char *input_dev = "/dev/input/event1";
    const char *beeper_dev = "/dev/input/event0";
    int do_takeover = 0;
    int i;

    /* Parse args: nle-gallery [--takeover] photo_dir [input_dev] */
    int argi = 1;
    while (argi < argc && argv[argi][0] == '-') {
        if (strcmp(argv[argi], "--takeover") == 0)
            do_takeover = 1;
        argi++;
    }
    if (argi < argc) photo_dir = argv[argi++];
    if (argi < argc) input_dev = argv[argi++];

    /* Singleton lock — prevent multiple instances */
    int lock_fd = open("/tmp/nle-gallery.lock", O_CREAT | O_RDWR, 0644);
    if (lock_fd >= 0) {
        if (flock(lock_fd, LOCK_EX | LOCK_NB) < 0) {
            fprintf(stderr, "Another nle-gallery is running, exiting\n");
            close(lock_fd);
            return 0;
        }
        /* Lock held for lifetime of process; kernel releases on exit/crash */
    }

    signal(SIGINT, sighandler);
    signal(SIGTERM, sighandler);
    signal(SIGPIPE, SIG_IGN);
    signal(SIGILL, crashhandler);
    signal(SIGABRT, crashhandler);
    signal(SIGBUS, crashhandler);
    signal(SIGFPE, crashhandler);
    signal(SIGSEGV, crashhandler);

    /* Allocate cache buffers + compositing buffer (total ~3.2 MB vs ~16 MB before) */
    for (i = 0; i < CACHE_SIZE; i++) {
        cache_buf[i] = malloc(IMG_SIZE);
        if (!cache_buf[i]) { fprintf(stderr, "malloc cache failed\n"); return 1; }
        cache_photo[i] = -1;
    }
    frame_buf = malloc(IMG_SIZE);
    if (!frame_buf) { fprintf(stderr, "malloc frame failed\n"); return 1; }

    if (do_takeover) {
        takeover_display();
    }

    /* Load photo paths and initial cache */
    load_photos(photo_dir);

    if (num_photos == 0) {
        fprintf(stderr, "No images found in %s\n", photo_dir);
        return 1;
    }
    fprintf(stderr, "Found %d photos (%d cached)\n", num_photos,
            CACHE_SIZE < num_photos ? CACHE_SIZE : num_photos);

    /* Open framebuffer */
    fb_fd = open("/dev/fb0", O_RDWR);
    if (fb_fd < 0) { perror("open /dev/fb0"); return 1; }
    fprintf(stderr, "fb0 opened\n");

    /* Open beeper */
    int beeper_fd = open(beeper_dev, O_WRONLY);
    if (beeper_fd >= 0)
        fprintf(stderr, "Beeper opened\n");

    /* Create pipe */
    int pipefd[2];
    if (pipe(pipefd) < 0) { perror("pipe"); return 1; }

    int flags = fcntl(pipefd[0], F_GETFL, 0);
    fcntl(pipefd[0], F_SETFL, flags | O_NONBLOCK);

    /* Fork child for input reading */
    child_pid = fork();
    if (child_pid == 0) {
        close(pipefd[0]);
        close(fb_fd);
        if (beeper_fd >= 0) close(beeper_fd);
        input_reader(pipefd[1], input_dev);
        _exit(0);
    }
    close(pipefd[1]);
    fprintf(stderr, "Input reader pid=%d\n", child_pid);

    /* Show first image */
    render();
    fprintf(stderr, "Running\n");
    fflush(stderr);

    int ring_active = 0;
    int idle_loops = 0;
    int ring_idle_loops = 0;
    int sleep_loops = 0;
    int peek_loops = 0;
    int motion_poll = 0;

    while (running) {
        fd_set rfds;
        struct timeval tv;
        FD_ZERO(&rfds);
        FD_SET(pipefd[0], &rfds);
        tv.tv_sec = 0;
        tv.tv_usec = 50000;

        int ret = select(pipefd[0] + 1, &rfds, NULL, NULL, &tv);

        /* --- Motion detection during sleep --- */
        if (!display_on && !gallery_paused && do_takeover) {
            motion_poll++;
            if (motion_poll >= MOTION_POLL) {
                motion_poll = 0;
                if (backlight_is_on()) {
                    /* nlclient detected motion and woke the display */
                    fprintf(stderr, "Motion detected (backlight on), entering peek\n");
                    fflush(stderr);
                    takeover_display();
                    display_on = 1;
                    peek_mode = 1;
                    peek_loops = 0;
                    /* Advance to next photo for variety */
                    current_idx = (current_idx + 1) % num_photos;
                    cache_preload();
                    offset = 0;
                    render();
                }
            }
        }

        if (ret > 0) {
            char buf[64];
            ssize_t n = read(pipefd[0], buf, sizeof(buf));
            i = 0;
            int got_ring = 0;
            int got_button = 0;
            int got_wake = 0;

            while (i < n) {
                if (buf[i] == MSG_RING && i + 1 < n) {
                    int8_t val = (int8_t)buf[i + 1];
                    i += 2;

                    if (!display_on) {
                        got_wake = 1;
                        continue;  /* consume but don't scroll while waking */
                    }
                    if (gallery_paused) {
                        continue;  /* ignore ring while Nest UI is active */
                    }
                    if (peek_mode) {
                        got_ring = 1;
                        /* Upgrade peek → gallery, apply this ring input */
                        offset += (int)val * RING_SCALE;
                        if (offset > WIDTH) offset = WIDTH;
                        if (offset < -WIDTH) offset = -WIDTH;
                        continue;
                    }

                    offset += (int)val * RING_SCALE;
                    if (offset > WIDTH) offset = WIDTH;
                    if (offset < -WIDTH) offset = -WIDTH;
                    got_ring = 1;
                } else if (buf[i] == MSG_BUTTON) {
                    i += 1;
                    got_button = 1;
                    /* Double-click detection */
                    struct timeval now;
                    gettimeofday(&now, NULL);
                    uint32_t now_ms = now.tv_sec * 1000 + now.tv_usec / 1000;
                    uint32_t last_ms = last_button_sec * 1000 + last_button_usec / 1000;
                    uint32_t delta = now_ms - last_ms;
                    last_button_sec = now.tv_sec;
                    last_button_usec = now.tv_usec;

                    if (delta > 0 && delta <= DCLICK_MS) {
                        /* Double-click: toggle gallery/Nest UI */
                        if (gallery_paused) {
                            takeover_display();
                            gallery_paused = 0;
                            peek_mode = 0;
                            if (!display_on) display_on = 1;
                            render();
                            fprintf(stderr, "Gallery resumed\n");
                        } else {
                            release_display();
                            gallery_paused = 1;
                            peek_mode = 0;
                            fprintf(stderr, "Gallery paused\n");
                        }
                        /* Reset so a third click doesn't re-trigger */
                        last_button_sec = 0;
                        last_button_usec = 0;
                        idle_loops = 0;
                        sleep_loops = 0;
                        got_button = 0;  /* handled as double-click */
                    } else if (!gallery_paused && !display_on) {
                        got_wake = 1;
                    }
                } else {
                    i += 1;  /* skip unknown */
                }
            }

            /* Ring/button during sleep → wake directly into gallery mode */
            if (got_wake && !display_on) {
                display_wake(do_takeover);
                peek_mode = 0;
                start_update();  /* non-blocking: fetch updates in background */
                render();
                idle_loops = 0;
                sleep_loops = 0;
            }

            /* Ring during peek → upgrade to full gallery */
            if (got_ring && peek_mode) {
                fprintf(stderr, "Ring input during peek, entering gallery\n");
                fflush(stderr);
                peek_mode = 0;
                idle_loops = 0;
                sleep_loops = 0;
                ring_idle_loops = 0;
                ring_active = 1;
                start_update();
                render();
            }

            /* Button during peek → upgrade to full gallery */
            if (got_button && peek_mode && display_on) {
                fprintf(stderr, "Button during peek, entering gallery\n");
                fflush(stderr);
                peek_mode = 0;
                idle_loops = 0;
                sleep_loops = 0;
            }

            if (got_ring && display_on && !peek_mode) {
                render();
                idle_loops = 0;
                ring_idle_loops = 0;
                ring_active = 1;
                sleep_loops = 0;
            }
        }

        /* --- Peek mode timeout --- */
        if (peek_mode && display_on) {
            peek_loops++;
            if (peek_loops >= PEEK_LOOPS) {
                fprintf(stderr, "Peek timeout, going back to sleep\n");
                fflush(stderr);
                display_sleep(do_takeover);
                peek_mode = 0;
                peek_loops = 0;
            }
            continue;  /* no auto-advance or sleep timer in peek mode */
        }

        if (!display_on || gallery_paused) {
            /* While sleeping or paused, just poll for events */
            continue;
        }

        /* Check if background update finished — reload photos */
        if (check_update_done()) {
            int old_count = num_photos;
            load_photos(photo_dir);
            if (num_photos > 0) {
                if (num_photos != old_count)
                    fprintf(stderr, "Reloaded: %d photos\n", num_photos);
                render();
            }
        }

        /* Snap when ring stops */
        if (ring_active) {
            ring_idle_loops++;
            if (ring_idle_loops >= RING_IDLE_LOOPS && offset != 0) {
                ring_active = 0;
                int half = WIDTH / 2;
                if (offset > half)
                    snap_to(WIDTH, beeper_fd);
                else if (offset < -half)
                    snap_to(-WIDTH, beeper_fd);
                else
                    snap_to(0, beeper_fd);
                idle_loops = 0;
            }
        }

        /* Auto-advance */
        idle_loops++;
        if (!ring_active && offset == 0 && idle_loops >= AUTO_LOOPS) {
            for (i = 1; i <= SNAP_FRAMES; i++) {
                int t = ease_out_fixed(i, SNAP_FRAMES);
                offset = WIDTH * t / 1024;
                render();
                usleep(SNAP_DELAY_US * 2);
            }
            current_idx = (current_idx + 1) % num_photos;
            offset = 0;
            cache_preload();
            render();
            idle_loops = 0;
        }

        /* Display sleep after inactivity (but not while update is downloading) */
        sleep_loops++;
        if (sleep_loops >= SLEEP_LOOPS) {
            if (update_pid > 0) {
                /* Update still running — stay awake so WiFi isn't killed */
                sleep_loops = SLEEP_LOOPS - 200;  /* re-check in 10s */
            } else {
                display_sleep(do_takeover);
                sleep_loops = 0;
            }
        }
    }

    if (child_pid > 0) kill(child_pid, SIGTERM);
    close(pipefd[0]);
    if (beeper_fd >= 0) close(beeper_fd);
    close(fb_fd);
    free(frame_buf);
    for (i = 0; i < CACHE_SIZE; i++) free(cache_buf[i]);

    return 0;
}
