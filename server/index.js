import http from "node:http";
import { handleRequest } from "./handler.js";

const server = http.createServer(handleRequest);

const port = Number(process.env.PORT) || 4731;
server.listen(port, () => {
  const key = process.env.TYPESAFE_API_KEY ? "key loaded" : (process.env.JEV_FIXTURE === "1" ? "fixture mode" : "TYPESAFE_API_KEY missing");
  console.log(`Directory listening on http://localhost:${port} (${key}${process.env.OPENAI_API_KEY ? ", OpenAI ready" : ""})`);
});
