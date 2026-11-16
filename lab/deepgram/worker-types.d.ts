declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}
interface WebSocket {
  accept(): void;
}
interface Response {
  webSocket?: WebSocket;
}
interface ResponseInit {
  webSocket?: WebSocket;
}
