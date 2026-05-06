import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export class HereyaAwsAuroraDataapiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Default to scale-to-zero with a 5-minute auto-pause.
    // Set minACU > 0 to opt out (auto-pause is then ignored, since AWS only
    // allows it when the min capacity is 0).
    const minACU = process.env.minACU !== undefined ? parseFloat(process.env.minACU) : 0;
    const maxACU = process.env.maxACU ? parseFloat(process.env.maxACU) : 4;
    const autoPauseMinutes = minACU === 0
      ? (process.env.autoPauseMinutes ? parseInt(process.env.autoPauseMinutes, 10) : 5)
      : undefined;

    if (
      autoPauseMinutes !== undefined &&
      (Number.isNaN(autoPauseMinutes) || autoPauseMinutes < 5 || autoPauseMinutes > 1440)
    ) {
      throw new Error('autoPauseMinutes must be an integer between 5 and 1440');
    }

    const engineVersion = process.env.engineVersion || '16.6';
    const autoDelete = process.env.autoDelete === 'true';

    // Look up default VPC
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { isDefault: true });

    // Security group for the cluster
    const securityGroup = new ec2.SecurityGroup(this, 'ClusterSecurityGroup', {
      vpc,
      description: 'Security group for Aurora PostgreSQL cluster',
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access'
    );

    // Aurora PostgreSQL major version
    const majorVersion = engineVersion.split('.')[0];

    // Aurora Serverless v2 cluster with Data API
    const cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of(engineVersion, majorVersion),
      }),
      credentials: rds.Credentials.fromGeneratedSecret('postgres'),
      writer: rds.ClusterInstance.serverlessV2('writer'),
      serverlessV2MinCapacity: minACU,
      serverlessV2MaxCapacity: maxACU,
      ...(autoPauseMinutes !== undefined
        ? { serverlessV2AutoPauseDuration: cdk.Duration.minutes(autoPauseMinutes) }
        : {}),
      enableDataApi: true,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [securityGroup],
      removalPolicy: autoDelete ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    });

    // IAM policy for Data API access
    const policyDocument = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'rds-data:ExecuteStatement',
            'rds-data:BatchExecuteStatement',
            'rds-data:BeginTransaction',
            'rds-data:CommitTransaction',
            'rds-data:RollbackTransaction',
          ],
          resources: [cluster.clusterArn],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: [cluster.secret!.secretArn],
        }),
      ],
    });

    // Store masterSecretArn in SSM so Hereya doesn't auto-resolve it as a secret value.
    // Downstream packages need the ARN itself (to pass to Data API), not the secret content.
    const masterSecretArnParam = new ssm.StringParameter(this, 'MasterSecretArnParam', {
      parameterName: `/${this.stackName}/master-secret-arn`,
      stringValue: cluster.secret!.secretArn,
      description: 'ARN of the Aurora master user secret',
    });

    // Outputs
    new cdk.CfnOutput(this, 'clusterArn', {
      value: cluster.clusterArn,
      description: 'The ARN of the Aurora cluster',
    });

    new cdk.CfnOutput(this, 'clusterEndpoint', {
      value: cluster.clusterEndpoint.hostname,
      description: 'The cluster writer endpoint',
    });

    new cdk.CfnOutput(this, 'masterSecretArn', {
      value: masterSecretArnParam.parameterArn,
      description: 'SSM parameter ARN containing the master user secret ARN',
    });

    new cdk.CfnOutput(this, 'awsRegion', {
      value: this.region,
      description: 'The AWS region',
    });

    new cdk.CfnOutput(this, 'iamPolicyAuroraDataApi', {
      value: JSON.stringify(policyDocument.toJSON()),
      description: 'IAM policy for Data API and secret access',
    });
  }
}
