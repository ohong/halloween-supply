import { agentInstructions } from "@/lib/agent/documents";

export function GET() {
  return new Response(agentInstructions(), { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}
