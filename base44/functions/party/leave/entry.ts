import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { leaveParty } from "../../../shared/party-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await leaveParty(clientFor(req), await req.json())); }
  catch (error) { return handleFunctionError(error); }
});
