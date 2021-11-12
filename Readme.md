## Amplify CLI resource cleanup script

This requires credentials to be setup as env variables.

The script iterates over the parent + all its child accounts and deletes
* S3 - (Known issue: fails delete versioned buckets)
* IAM
* Cloudformation
* ES Domains

TODO
* Lambda Function
* Cognito

To run