import { DBSQLClient } from '@databricks/sql';

const serverHostname = process.env.DATABRICKS_SERVER_HOSTNAME;
const httpPath = process.env.DATABRICKS_HTTP_PATH;
const token = process.env.DATABRICKS_TOKEN;

if (!serverHostname || !httpPath || !token) {
  throw new Error('DATABRICKS_SERVER_HOSTNAME, DATABRICKS_HTTP_PATH e DATABRICKS_TOKEN sao obrigatorios');
}

export async function createDatabricksClient(): Promise<DBSQLClient> {
  const client = new DBSQLClient();

  await client.connect({
    host: serverHostname,
    path: httpPath,
    token: token,
  });

  return client;
}

export const databricksTable = process.env.DATABRICKS_TABLE || 'manutencao.streaming.notas_qm';
