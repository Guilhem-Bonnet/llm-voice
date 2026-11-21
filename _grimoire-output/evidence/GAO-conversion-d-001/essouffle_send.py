import sys, http.client
body = sys.stdin.buffer.read()
c = http.client.HTTPConnection("127.0.0.1", 8022, timeout=300)
c.request("POST", "/convert", body=body, headers={"Content-Type": "multipart/form-data; boundary=essai-essouffle"})
r = c.getresponse(); data = r.read()
sys.stderr.write(f"status {r.status}\n"); sys.stdout.buffer.write(data)
