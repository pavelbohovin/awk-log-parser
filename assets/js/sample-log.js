/**
 * Realistic combined access log sample for demos (never leaves the browser).
 */
(function (global) {
  'use strict';

  var SAMPLE_LOG = [
    '203.0.113.45 - - [14/Oct/2023:10:45:01 +0000] "GET /api/v1/auth/login HTTP/1.1" 200 1240 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"',
    '203.0.113.45 - - [14/Oct/2023:10:45:02 +0000] "POST /api/v1/auth/login HTTP/1.1" 401 89 "https://app.example.com/login" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"',
    '198.51.100.12 - - [14/Oct/2023:10:45:03 +0000] "GET /static/app.bundle.js HTTP/1.1" 200 892341 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"',
    '198.51.100.12 - - [14/Oct/2023:10:45:03 +0000] "GET /static/app.css HTTP/1.1" 200 48210 "https://app.example.com/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"',
    '45.23.11.12 - - [14/Oct/2023:10:45:04 +0000] "POST /api/v1/data/query HTTP/1.1" 200 4096 "https://app.example.com/dashboard" "curl/7.88.1"',
    '45.23.11.12 - - [14/Oct/2023:10:45:05 +0000] "GET /api/v1/data/query HTTP/1.1" 429 512 "-" "curl/7.88.1"',
    '192.168.1.104 - - [14/Oct/2023:10:45:06 +0000] "GET /wp-admin/admin-ajax.php?action=heartbeat HTTP/1.1" 200 128 "-" "WordPress/6.4; https://blog.example.com"',
    '192.168.1.104 - - [14/Oct/2023:10:45:07 +0000] "POST /wp-admin/admin-ajax.php HTTP/1.1" 500 0 "https://blog.example.com/wp-admin/" "WordPress/6.4; https://blog.example.com"',
    '10.0.0.55 - - [14/Oct/2023:10:45:08 +0000] "GET /favicon.ico HTTP/1.1" 304 0 "https://app.example.com/" "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"',
    '10.0.0.55 - - [14/Oct/2023:10:45:09 +0000] "GET /api/v1/users/me HTTP/1.1" 200 892 "-" "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"',
    '172.16.0.8 - - [14/Oct/2023:10:45:10 +0000] "GET /.env HTTP/1.1" 403 162 "-" "python-requests/2.31.0"',
    '172.16.0.8 - - [14/Oct/2023:10:45:11 +0000] "GET /wp-login.php HTTP/1.1" 404 512 "-" "python-requests/2.31.0"',
    '203.0.113.99 - - [14/Oct/2023:10:45:12 +0000] "HEAD /health HTTP/1.1" 200 0 "-" "kube-probe/1.28"',
    '203.0.113.99 - - [14/Oct/2023:10:45:13 +0000] "GET /health HTTP/1.1" 200 12 "-" "kube-probe/1.28"',
    '198.51.100.77 - - [14/Oct/2023:10:45:14 +0000] "GET /api/v1/reports/export.csv HTTP/1.1" 200 2849102 "https://app.example.com/reports" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"',
    '198.51.100.77 - - [14/Oct/2023:10:45:15 +0000] "GET /api/v1/reports/export.csv HTTP/1.1" 504 0 "https://app.example.com/reports" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"',
    '45.23.11.12 - - [14/Oct/2023:10:45:16 +0000] "OPTIONS /api/v1/data/query HTTP/1.1" 204 0 "https://app.example.com/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"',
    '192.0.2.15 - - [14/Oct/2023:10:45:17 +0000] "GET /nginx_status HTTP/1.1" 200 98 "-" "Prometheus/2.47.0"',
    '192.0.2.15 - - [14/Oct/2023:10:45:18 +0000] "GET /metrics HTTP/1.1" 200 184422 "-" "Prometheus/2.47.0"',
    '10.0.0.122 - - [14/Oct/2023:10:45:19 +0000] "DELETE /api/v1/sessions/abc123 HTTP/1.1" 204 0 "-" "Mozilla/5.0 (X11; Linux x86_64)"',
    '10.0.0.122 - - [14/Oct/2023:10:45:20 +0000] "PATCH /api/v1/users/42 HTTP/1.1" 200 445 "-" "Mozilla/5.0 (X11; Linux x86_64)"',
    '203.0.113.45 - - [14/Oct/2023:10:45:21 +0000] "GET /api/v1/search?q=logs HTTP/1.1" 200 8192 "https://app.example.com/" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"',
    '203.0.113.45 - - [14/Oct/2023:10:45:22 +0000] "GET /api/v1/search?q=logs HTTP/1.1" 200 8192 "https://app.example.com/" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"',
    '198.51.100.12 - - [14/Oct/2023:10:45:23 +0000] "GET /robots.txt HTTP/1.1" 200 124 "-" "Googlebot/2.1 (+http://www.google.com/bot.html)"',
    '198.51.100.12 - - [14/Oct/2023:10:45:24 +0000] "GET /sitemap.xml HTTP/1.1" 200 4096 "-" "Googlebot/2.1 (+http://www.google.com/bot.html)"',
    '45.23.11.12 - - [14/Oct/2023:10:45:25 +0000] "POST /api/v1/webhooks/stripe HTTP/1.1" 202 56 "-" "Stripe/1.0 (+https://stripe.com/docs/webhooks)"',
    '192.168.1.104 - - [14/Oct/2023:10:45:26 +0000] "GET /wp-content/uploads/2023/10/image.jpg HTTP/1.1" 200 284910 "-" "WordPress/6.4; https://blog.example.com"',
    '172.16.0.5 - - [14/Oct/2023:10:45:27 +0000] "GET /admin HTTP/1.1" 301 178 "-" "Mozilla/5.0 compatible; scanner/1.0"',
    '172.16.0.5 - - [14/Oct/2023:10:45:28 +0000] "GET /admin/ HTTP/1.1" 403 162 "-" "Mozilla/5.0 compatible; scanner/1.0"',
    '--- malformed log fragment ---',
    '10.0.0.55 - - [14/Oct/2023:10:45:29 +0000] "GET /api/v1/notifications HTTP/1.1" 200 340 "-" "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"',
    '203.0.113.45 - - [14/Oct/2023:10:45:30 +0000] "GET /logout HTTP/1.1" 302 0 "https://app.example.com/settings" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"',
    '203.0.113.45 - - [14/Oct/2023:10:45:31 +0000] "GET /login HTTP/1.1" 200 4521 "https://app.example.com/" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"',
  ].join('\n');

  global.AwkSampleLog = {
    name: 'production-access.log',
    content: SAMPLE_LOG,
    lineCount: SAMPLE_LOG.split('\n').length,
  };
})(typeof window !== 'undefined' ? window : self);
