import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { tournamentStatus } from "../../../shared/season-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await tournamentStatus(clientFor(req))); }
  catch (error) { return handleFunctionError(error); }
});
