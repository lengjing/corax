import {
  CORAX_SESSION_ID_HEADER,
  CORAX_STREAM_FORMAT_HEADER,
  CORAX_STREAM_TAIL_INDEX_HEADER,
  CORAX_STREAM_VERSION_HEADER,
} from "#protocol/message.js";

export function proxyStreamHeaders(headers: Headers): Headers {
  const allowed = [
    "cache-control",
    "content-type",
    "x-accel-buffering",
    CORAX_SESSION_ID_HEADER,
    CORAX_STREAM_FORMAT_HEADER,
    CORAX_STREAM_TAIL_INDEX_HEADER,
    CORAX_STREAM_VERSION_HEADER,
  ];
  return new Headers([...headers].filter(([name]) => allowed.includes(name)));
}
