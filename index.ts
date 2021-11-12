
import * as sdk from 'aws-sdk';
import { RSA_PKCS1_OAEP_PADDING } from 'constants';
(async () => {
    const organization = new sdk.Organizations();
    const accounts = await organization.listAccounts().promise();
    const sts = new sdk.STS();
    const identity = await sts.getCallerIdentity().promise();
    const regions = ['us-east-2', 'us-west-2', 'eu-west-2', 'eu-central-1', 'ap-northeast-1', 'ap-southeast-1', 'ap-southeast-2'];

    await Promise.all(accounts.Accounts.map(async (account) => {
        const role =  `arn:aws:iam::${account.Id}:role/OrganizationAccountAccessRole`;

        
        const assumedCreds = account.Id !== identity.Account ? await getCreds(role, account) : undefined;
        const s3 = new sdk.S3(assumedCreds ? { credentials: assumedCreds } : undefined);
        await deletAllBuckets(account, s3)

        const iam  = new sdk.IAM(assumedCreds ? { credentials: assumedCreds }: undefined);
        await deleteRoles(iam);
        for await(const region of regions) {
            const cloudformation = new sdk.CloudFormation(assumedCreds ? { region, credentials: assumedCreds  } : { region  })
            await deleteCIStacks(cloudformation);
            await sleep(1000);
            const amplify = new sdk.Amplify(assumedCreds ? { region, credentials: assumedCreds } : { region });
            await deleteAmplifyApps(amplify);
            await sleep(1000);
            const es = new sdk.ES(assumedCreds ? { region, credentials: assumedCreds  } : { region  } );
            await deleteEsDomains(es);
            await sleep(1000);
        }
    }))
 
})();

// async function deleteLambdas(lambda: sdk.Lambda) {
//   let isTruncated = false;
//   let nextToken = undefined;
//   do {
//     const lambdaResult = await lambda.listFunctions({ Marker: nextToken }).promise();
//     nextToken = lambdaResult.NextMarker;
//     isTruncated = !!nextToken;
//     for await (const lambdaFunction of lambdaResult.Functions){
//       console.log('deleting domain' + lambdaFunction.FunctionName)
//       await lambda.deleteFunction({ FunctionName: lambdaFunction.FunctionName }).promise();
//       console.log('deleted domain ' + lambdaFunction.FunctionName)
//     }

//   }while(isTruncated);
// }

async function deleteEsDomains(es : sdk.ES) {
  let isTruncated = false;
  let nextToken = undefined;
  do {
    
    try{ const domains = await es.listDomainNames().promise();
    for await (const domain of domains.DomainNames){
      console.log('deleting domain ' + domain.DomainName)
      try{
        await sleep(200)
        await es.deleteElasticsearchDomain({ DomainName : domain.DomainName }).promise();
        console.log('deleted domain ' + domain.DomainName)

      }catch(ex) {
        console.log(ex.message);
        console.log('failed to domain ' + domain.DomainName)

       }
      
    }
  }catch(ex) {}


  }while(isTruncated);
}

async function deleteRoles(iam: sdk.IAM) {
  let nextToken = undefined;
  let isTruncated = false;
  do {
    const roleResult = await iam.listRoles({ Marker: nextToken }).promise();
    isTruncated = roleResult.IsTruncated
    nextToken = roleResult.Marker;
    for await(const role of roleResult.Roles) {
      try{
        await sleep(500);

      const roledesc = await iam.listRoleTags({ RoleName: role.RoleName }).promise();
      if(roledesc.Tags.length > 0 && roledesc.Tags.some(r => r.Key === 'user:Stack' || r.Key === 'user:Application')) {
          console.log('Deleting Role  ' + role.RoleName);
          await detachRolePolicies(role, iam);
          await iam.deleteRole({ RoleName: role.RoleName }).promise();
          console.log('Deleted ' + role.RoleName);
          await sleep(200)

        } 
      }catch(ex) {
        console.log(ex.message);
        console.log('Failed to Delete' + role.RoleName)
      }

    }

  }while(isTruncated);
}

async function detachRolePolicies(role: sdk.IAM.Role, iam: sdk.IAM) {

  let isTruncated = false;
  let nextToken = undefined;
  do {
    const rolePolicyResult = await iam.listRolePolicies({ RoleName: role.RoleName ,Marker: nextToken }).promise();
    isTruncated = rolePolicyResult.IsTruncated;
    nextToken = rolePolicyResult.Marker;
    for await(const policyName of rolePolicyResult.PolicyNames){
      await iam.deleteRolePolicy({ RoleName: role.RoleName, PolicyName: policyName  }).promise();
    }
  } while(isTruncated);
  isTruncated = false;
  nextToken = undefined;

  do {
    const rolePolicyResult = await iam.listAttachedRolePolicies({ RoleName: role.RoleName, Marker: nextToken }).promise();
    await sleep(300);
    isTruncated = rolePolicyResult.IsTruncated;
    nextToken = rolePolicyResult.Marker;
    for await(const policyName of rolePolicyResult.AttachedPolicies){
      await iam.detachRolePolicy({ PolicyArn: policyName.PolicyArn, RoleName: role.RoleName  }).promise();
      await sleep(300);
    }
  } while(isTruncated);


}

async function deleteAmplifyApps(amplify: sdk.Amplify) {
  let isTruncated = false;
  let nextToken = undefined;
  do {
    await sleep(300);
    const appsResult = await amplify.listApps({ nextToken: undefined }).promise();
    for await (const app of appsResult.apps){
      console.log('Deleting App' + app.name);
      await amplify.deleteApp({ appId: app.appId }).promise();
      console.log('Deleted App' + app.name);
      await sleep(300);
    }
    
    nextToken = appsResult.nextToken;
    isTruncated = !!nextToken;
  }while(isTruncated);
  
}
async function getCreds(role: string, account: sdk.Organizations.Account) {
    const sts = new sdk.STS();
    const creds = await sts.assumeRole({ RoleArn: role, RoleSessionName: `${account.Name}-delete`, DurationSeconds: 3600 }).promise();
    return {
        accessKeyId: creds.Credentials.AccessKeyId,
        secretAccessKey: creds.Credentials.SecretAccessKey,
        sessionToken: creds.Credentials.SessionToken
    };
}

const deleteCIStacks = async(cloudformation: sdk.CloudFormation) => {
    let isTruncated = false;
    let nextToken = undefined;
    do {

        const stacksResult = await cloudformation.listStacks({ 
            NextToken: nextToken,
            StackStatusFilter: ["CREATE_COMPLETE", "ROLLBACK_FAILED", "ROLLBACK_COMPLETE", "DELETE_FAILED", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_FAILED", "UPDATE_ROLLBACK_COMPLETE"] 
        }).promise();
        await sleep(300);
        isTruncated =  !!stacksResult.NextToken;
        nextToken = stacksResult.NextToken;
        for await(const stack of stacksResult.StackSummaries) {
            const stackdesc = await cloudformation.describeStacks({ StackName: stack.StackName }).promise();
            await sleep(300);
            if(stackdesc.Stacks && stackdesc.Stacks.length > 0 && !stackdesc.Stacks[0].ParentId && !stack.StackName.toLowerCase().includes('cdktoolkit')) {
                console.log('Deleting stack ' + stack.StackName );
                try{
                    await cloudformation.deleteStack({ StackName: stack.StackName  }).promise();
                    await sleep(500)
                } catch(ex){
                    console.log('Delete failed')
                }
            }
        }
    } while(isTruncated);
    
}

const sleep = async(time: number) => new Promise(resolve => setTimeout(resolve, time));

const deletAllBuckets =  async(account: { Id?: string }, s3: sdk.S3 ) => {
   
    const listBuckets = await s3.listBuckets().promise();
    for await (const bucket of listBuckets.Buckets) {
       if(bucket.Name.includes('do-not-delete') || bucket.Name.includes('cdktoolkit')){
           console.log('skipping...' + account.Id +'   :   ' + bucket.Name);
           continue;
       }
       console.log('Deleting...  ' + account.Id +'   :   ' + bucket.Name);

       try {
           await emptyBucket(bucket.Name, null, s3);
           await deleteVersionMarkers(bucket.Name, null, s3);
           await s3.deleteBucket({ Bucket: bucket.Name }).promise();
           console.log(`Deleted `)
       }
       catch(ex){
           console.error(ex.message);
           console.log('Failed Deleting...' + account.Id +'   :   ' + bucket.Name);
       }
    }
}

const emptyBucket = async (Bucket, NextContinuationToken, s3: sdk.S3, list = []) => {
    if (NextContinuationToken || list.length === 0) {
      return await s3
        .listObjectsV2({ Bucket, ContinuationToken: NextContinuationToken })
        .promise()
        .then(async ({ Contents, NextContinuationToken }) => {
          if (Contents.length) {
            await s3
              .deleteObjects({
                Bucket,
                Delete: {
                  Objects: Contents.map((item) => ({ Key: item.Key })),
                },
              })
              .promise();
            if (NextContinuationToken) {
              console.log('deleted', NextContinuationToken);
            }
            return await emptyBucket(Bucket, NextContinuationToken, s3, [
              ...list,
              ...Contents.map((item) => item.Key),
            ]);
          }
          return list;
        });
    }
    return list;
  };

  const deleteVersionMarkers = async (Bucket, NextKeyMarker, s3: sdk.S3, list = []) => {
    if (NextKeyMarker || list.length === 0) {
      return await s3
        .listObjectVersions({ Bucket, KeyMarker: NextKeyMarker })
        .promise()
        .then(async ({ DeleteMarkers, Versions, NextKeyMarker }) => {
          if (DeleteMarkers.length) {
            await s3
              .deleteObjects({
                Bucket,
                Delete: {
                  Objects: DeleteMarkers.map((item) => ({
                    Key: item.Key,
                    VersionId: item.VersionId,
                  })),
                },
              })
              .promise();
            if (NextKeyMarker) {
              console.log('deleted', NextKeyMarker);
            }
            return await deleteVersionMarkers(Bucket, NextKeyMarker, s3, [
              ...list,
              ...DeleteMarkers.map((item) => item.Key),
            ]);
          }
          if (Versions.length) {
            await s3
              .deleteObjects({
                Bucket,
                Delete: {
                  Objects: Versions.map((item) => ({
                    Key: item.Key,
                    VersionId: item.VersionId,
                  })),
                },
              })
              .promise();
            if (NextKeyMarker) {
              console.log('deleted', NextKeyMarker);
            }
            return await deleteVersionMarkers(Bucket, NextKeyMarker, s3, [
              ...list,
              ...Versions.map((item) => item.Key),
            ]);
          }
          return list;
        });
    }
    return list;
  };










