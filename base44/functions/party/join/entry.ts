import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { joinParty } from "../../../shared/party-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await joinParty(clientFor(req), await req.json())); }
  catch (error) { return handleFunctionError(error); }
});
