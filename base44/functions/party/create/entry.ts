import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { createParty } from "../../../shared/party-service.js";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    return Response.json(await createParty(clientFor(req), await req.json()));
  } catch (error) { return handleFunctionError(error); }
});
