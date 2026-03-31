#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { HereyaAwsAuroraDataapiStack } from '../lib/hereya-aws-aurora-dataapi-stack';

const app = new cdk.App();
new HereyaAwsAuroraDataapiStack(app, process.env.STACK_NAME!, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
