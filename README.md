# hereya-aws-aurora-dataapi

Provisions an Aurora Serverless v2 PostgreSQL cluster with the **Data API** enabled. Designed as shared infrastructure for a multi-tenant app platform where each app gets its own database and user, created programmatically via the Data API.

This stack is deployed **once**. The per-app provisioning stack uses the `masterSecretArn` and `clusterArn` outputs to run SQL commands (via a custom resource Lambda) such as `CREATE DATABASE` and `CREATE USER` for each tenant.

## Architecture

```
┌─────────────────────────────────────────────────┐
│        Aurora Serverless v2 PostgreSQL           │
│        (Data API enabled)                        │
│                                                  │
│  ┌──────────────┐  ┌──────────────┐             │
│  │ julie_recipes │  │ acme_dash    │  ...        │
│  │ _db           │  │ _db          │             │
│  └──────────────┘  └──────────────┘             │
│                                                  │
│  Master secret (postgres) in Secrets Manager     │
│  Per-app secrets created by app provisioning     │
└─────────────────────────────────────────────────┘
          ^
          | Data API (rds-data:ExecuteStatement)
          |
    App provisioning stack
```

## AWS Resources Created

- **VPC** -- Uses the default VPC (looked up at synth time)
- **Security Group** -- Allows inbound TCP on port 5432 from all IPv4 addresses, all outbound traffic
- **Aurora Serverless v2 Cluster** -- PostgreSQL engine with Data API enabled
  - Serverless v2 writer instance with configurable min/max ACU scaling
  - Master credentials auto-generated and stored in AWS Secrets Manager
- **Secrets Manager Secret** -- Auto-created by CDK for the `postgres` master user

## Inputs

Configuration is provided via environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `minACU` | No | `0.5` | Minimum Aurora Capacity Units for Serverless v2 scaling. Valid range: 0.5 to 128. Lower values reduce cost during idle periods. |
| `maxACU` | No | `4` | Maximum Aurora Capacity Units for Serverless v2 scaling. Valid range: 1 to 128. Must be >= minACU. |
| `engineVersion` | No | `16.6` | Aurora PostgreSQL engine version (e.g., `16.6`, `15.4`, `14.9`). The major version is extracted automatically for the engine family. |
| `autoDelete` | No | `false` | Set to `true` to enable cluster deletion on stack removal (sets removal policy to DESTROY). **Not recommended for production.** |

## Outputs

| Output | Description | Example Value |
|--------|-------------|---------------|
| `clusterArn` | The ARN of the Aurora cluster. Required for Data API calls (`rds-data:ExecuteStatement`). | `arn:aws:rds:us-east-1:123456789:cluster:serverless-abc123` |
| `clusterEndpoint` | The cluster writer endpoint hostname. Can be used for direct connections if needed. | `serverless-abc123.cluster-xyz.us-east-1.rds.amazonaws.com` |
| `masterSecretArn` | The ARN of the master user secret in Secrets Manager. The app provisioning stack uses this to authenticate Data API calls for creating per-app databases and users. | `arn:aws:secretsmanager:us-east-1:123456789:secret:AuroraClusterSecret-AbCdEf` |
| `awsRegion` | The AWS region where the cluster was created. | `us-east-1` |
| `iamPolicyAuroraDataApi` | JSON-serialized IAM policy document granting Data API access to the cluster and read access to the master secret. Includes: `rds-data:ExecuteStatement`, `rds-data:BatchExecuteStatement`, `rds-data:BeginTransaction`, `rds-data:CommitTransaction`, `rds-data:RollbackTransaction`, and `secretsmanager:GetSecretValue`. | `{"Version":"2012-10-17","Statement":[...]}` |

## Usage with Hereya

```bash
hereya add hereya/aws-aurora-dataapi
```

With custom scaling:

```bash
hereya add hereya/aws-aurora-dataapi -p minACU=1 -p maxACU=8
```

## How the Per-App Stack Uses This

The app provisioning stack uses the Data API (via a custom resource Lambda) to create isolated databases:

```sql
-- Run via rds-data:ExecuteStatement against clusterArn + masterSecretArn
CREATE DATABASE julie_recipes_db;
CREATE USER julie_recipes_user WITH PASSWORD 'generated-password';
GRANT ALL PRIVILEGES ON DATABASE julie_recipes_db TO julie_recipes_user;
```

Then it creates a new Secrets Manager secret for the app user and passes the secret ARN to the app's Lambda function.

## Data API Usage

Once deployed, you can query the cluster via the AWS CLI:

```bash
aws rds-data execute-statement \
  --resource-arn "arn:aws:rds:us-east-1:123:cluster:serverless-abc" \
  --secret-arn "arn:aws:secretsmanager:us-east-1:123:secret:XYZ" \
  --database "postgres" \
  --sql "SELECT version();"
```

## Development

```bash
npm install
npm run build    # Compile TypeScript
npm run watch    # Watch mode
npx cdk synth    # Synthesize CloudFormation template
npx cdk deploy   # Deploy stack
```

## Notes

- The cluster is placed in **public subnets** of the default VPC. Data API access does not require VPC connectivity -- it goes through the AWS service endpoint.
- The security group allows inbound PostgreSQL (5432) from all IPs. For production, consider restricting this to specific CIDR ranges or security groups.
- The master user is `postgres`. Avoid using it for application workloads -- create per-app users instead.
