/*
 * nle-fetch: Minimal HTTP file downloader for Nest Gen 2
 * Uses musl's resolver (works on kernel 2.6.37).
 * No HTTPS — designed for plain HTTP only.
 * Usage: nle-fetch <url> <output-file>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netdb.h>
#include <errno.h>
#include <fcntl.h>

#define BUF_SIZE 4096

static int parse_url(const char *url, char *host, int hostlen,
                     char *path, int pathlen, int *port) {
    const char *p = url;
    if (strncmp(p, "http://", 7) == 0) p += 7;

    const char *slash = strchr(p, '/');
    const char *colon = strchr(p, ':');

    if (colon && (!slash || colon < slash)) {
        int hlen = colon - p;
        if (hlen >= hostlen) return -1;
        memcpy(host, p, hlen);
        host[hlen] = 0;
        *port = atoi(colon + 1);
    } else {
        int hlen = slash ? (slash - p) : (int)strlen(p);
        if (hlen >= hostlen) return -1;
        memcpy(host, p, hlen);
        host[hlen] = 0;
        *port = 80;
    }

    if (slash) {
        int plen = strlen(slash);
        if (plen >= pathlen) return -1;
        memcpy(path, slash, plen);
        path[plen] = 0;
    } else {
        path[0] = '/';
        path[1] = 0;
    }
    return 0;
}

int main(int argc, char *argv[]) {
    if (argc < 3) {
        fprintf(stderr, "Usage: nle-fetch <url> <output-file>\n");
        return 1;
    }

    char host[256], path[1024];
    int port;
    if (parse_url(argv[1], host, sizeof(host), path, sizeof(path), &port) < 0) {
        fprintf(stderr, "Bad URL\n");
        return 1;
    }

    /* Resolve hostname */
    struct addrinfo hints, *res;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;

    char portstr[16];
    snprintf(portstr, sizeof(portstr), "%d", port);

    int err = getaddrinfo(host, portstr, &hints, &res);
    if (err) {
        fprintf(stderr, "DNS failed: %s\n", gai_strerror(err));
        return 1;
    }

    int sock = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
    if (sock < 0) { perror("socket"); freeaddrinfo(res); return 1; }

    if (connect(sock, res->ai_addr, res->ai_addrlen) < 0) {
        perror("connect");
        close(sock);
        freeaddrinfo(res);
        return 1;
    }
    freeaddrinfo(res);

    /* Send HTTP request */
    char req[2048];
    int reqlen = snprintf(req, sizeof(req),
        "GET %s HTTP/1.0\r\n"
        "Host: %s\r\n"
        "Connection: close\r\n"
        "\r\n", path, host);

    if (write(sock, req, reqlen) != reqlen) {
        perror("write");
        close(sock);
        return 1;
    }

    /* Read response */
    char buf[BUF_SIZE];
    int total = 0;
    int header_done = 0;
    int status_code = 0;
    int out_fd = -1;
    char *body_start = NULL;

    /* Read headers first */
    char hdr_buf[8192];
    int hdr_len = 0;

    while (!header_done && hdr_len < (int)sizeof(hdr_buf) - 1) {
        int n = read(sock, hdr_buf + hdr_len, sizeof(hdr_buf) - 1 - hdr_len);
        if (n <= 0) break;
        hdr_len += n;
        hdr_buf[hdr_len] = 0;

        char *end = strstr(hdr_buf, "\r\n\r\n");
        if (end) {
            header_done = 1;
            body_start = end + 4;

            /* Parse status */
            if (strncmp(hdr_buf, "HTTP/", 5) == 0) {
                char *sp = strchr(hdr_buf, ' ');
                if (sp) status_code = atoi(sp + 1);
            }

            if (status_code != 200) {
                fprintf(stderr, "HTTP %d\n", status_code);
                close(sock);
                return 1;
            }

            /* Open output file */
            out_fd = open(argv[2], O_WRONLY | O_CREAT | O_TRUNC, 0644);
            if (out_fd < 0) { perror("open output"); close(sock); return 1; }

            /* Write any body data already read */
            int body_bytes = hdr_len - (body_start - hdr_buf);
            if (body_bytes > 0) {
                write(out_fd, body_start, body_bytes);
                total += body_bytes;
            }
        }
    }

    if (!header_done) {
        fprintf(stderr, "No HTTP response\n");
        close(sock);
        return 1;
    }

    /* Read body */
    int n;
    while ((n = read(sock, buf, BUF_SIZE)) > 0) {
        write(out_fd, buf, n);
        total += n;
    }

    close(out_fd);
    close(sock);

    fprintf(stderr, "%d bytes\n", total);
    return 0;
}
