import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info(
    {
      service: "bbge",
      host: "0.0.0.0",
      port,
      health: `http://localhost:${port}/health`,
      extract: `http://localhost:${port}/api/extract`,
      bbgeExtract: `http://localhost:${port}/api/bbge/extract`,
    },
    "BBGE API server listening",
  );
});
