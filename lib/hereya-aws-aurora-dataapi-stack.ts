import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';

export class HereyaAwsAuroraDataapiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const minACU = process.env.minACU ? parseFloat(process.env.minACU) : 0.5;
    const maxACU = process.env.maxACU ? parseFloat(process.env.maxACU) : 4;
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
      value: cluster.secret!.secretArn,
      description: 'The ARN of the master user secret',
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
