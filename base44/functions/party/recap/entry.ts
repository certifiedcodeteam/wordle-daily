import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { partyRecap } from "../../../shared/party-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await partyRecap(clientFor(req), await req.json())); }
  catch (error) { return handleFunctionError(error); }
});
