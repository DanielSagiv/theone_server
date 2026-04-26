const AWS = require('aws-sdk');

// Load environment variables
require('dotenv').config();

/**
 * Fix permissions for existing files in events folder
 */
async function fixEventsPermissions() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('S3_BUCKET is not configured');
  }

  AWS.config.update({
    accessKeyId: process.env.S3_AKI,
    secretAccessKey: process.env.S3_SEC,
    region: process.env.AWS_REGION || process.env.S3_REGION || 'us-east-2'
  });

  const s3 = new AWS.S3();

  try {
    console.log(`Fixing permissions for files in s3://${bucket}/events/`);

    // List all objects in events folder
    const listParams = {
      Bucket: bucket,
      Prefix: 'events/'
    };

    const listedObjects = await s3.listObjectsV2(listParams).promise();

    if (listedObjects.Contents.length === 0) {
      console.log('No files found in events folder');
      return;
    }

    console.log(`Found ${listedObjects.Contents.length} files to update`);

    // Update ACL for each file
    for (const object of listedObjects.Contents) {
      try {
        await s3.putObjectAcl({
          Bucket: bucket,
          Key: object.Key,
          ACL: 'public-read'
        }).promise();
        
        console.log(`✅ Updated permissions for: ${object.Key}`);
      } catch (error) {
        console.error(`❌ Failed to update: ${object.Key}`, error.message);
      }
    }

    console.log('✅ Permission update complete!');
  } catch (error) {
    console.error('❌ Error fixing permissions:', error.message);
  }
}

// Run the script
if (require.main === module) {
  fixEventsPermissions();
}

module.exports = { fixEventsPermissions };
