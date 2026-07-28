import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { partyStatus } from "../../../shared/party-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await partyStatus(clientFor(req), await req.json())); }
  catch (error) { return handleFunctionError(error); }
});
