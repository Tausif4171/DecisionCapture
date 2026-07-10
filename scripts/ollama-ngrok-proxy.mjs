import http from "node:http";
import { URL } from "node:url";

const listenHost = process.env.OLLAMA_PROXY_HOST ?? "127.0.0.1";
const listenPort = Number(process.env.OLLAMA_PROXY_PORT ?? 11435);
const target = new URL(process.env.OLLAMA_PROXY_TARGET ?? "http://127.0.0.1:11434");

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

function forwardedHeaders(headers) {
  const result = {};

  for (const [name, value] of Object.entries(headers)) {
    if (!hopByHopHeaders.has(name.toLowerCase()) && value !== undefined) {
      result[name] = value;
    }
  }

  result.host = target.host;
  delete result.origin;
  return result;
}

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", target: target.origin }));
    return;
  }

  const targetUrl = new URL(request.url ?? "/", target);
  const proxyRequest = http.request(
    targetUrl,
    {
      method: request.method,
      headers: forwardedHeaders(request.headers)
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
      proxyResponse.pipe(response);
    }
  );

  proxyRequest.on("error", (error) => {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: "OllamaProxyError",
        message: error.message
      })
    );
  });

  request.pipe(proxyRequest);
});

server.listen(listenPort, listenHost, () => {
  console.log(
    `DecisionCapture Ollama proxy listening at http://${listenHost}:${listenPort} -> ${target.origin}`
  );
});
