import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { startParty } from "../../../shared/party-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await startParty(clientFor(req), await req.json())); }
  catch (error) { return handleFunctionError(error); }
});
