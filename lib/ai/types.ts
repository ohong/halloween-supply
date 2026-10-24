import type { InferUITools, UIMessage } from "ai";
import type { ChatTools } from "./tools";

/** The assistant's UI message type, with typed tool parts. Type-only import: no server code ships to the browser. */
export type AssistantMessage = UIMessage<never, never, InferUITools<ChatTools>>;
