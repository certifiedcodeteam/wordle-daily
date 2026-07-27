import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { wordInsightForSession } from "../../../shared/word-insight-service.js";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed", code: "method_not_allowed" }, { status: 405 });
    return Response.json(await wordInsightForSession(clientFor(req), await req.json()));
  } catch (error) {
    return handleFunctionError(error);
  }
});
