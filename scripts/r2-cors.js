/* R2 버킷의 CORS를 한 번 설정합니다. 사이트 주소가 바뀌면 다시 실행하세요.
   npm run r2-cors
   추가로 허용할 주소는 .env의 R2_CORS_ORIGINS에 쉼표로 적습니다. */
require("dotenv").config();

const { S3Client, PutBucketCorsCommand } = require("@aws-sdk/client-s3");

const bucket = process.env.R2_BUCKET || "oncodelab-vod";

if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  console.error(".env에 R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY를 넣어 주세요.");
  process.exit(1);
}

const origins = ["http://localhost:3000", "https://oncodelab-vod.vercel.app"]
  .concat(String(process.env.R2_CORS_ORIGINS || "").split(","))
  .map(function (item) { return item.trim().replace(/\/$/, ""); })
  .filter(function (item, index, list) { return item && list.indexOf(item) === index; });

const client = new S3Client({
  region: "auto",
  endpoint: "https://" + process.env.R2_ACCOUNT_ID + ".r2.cloudflarestorage.com",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

client.send(new PutBucketCorsCommand({
  Bucket: bucket,
  CORSConfiguration: {
    CORSRules: [{
      AllowedOrigins: origins,
      AllowedMethods: ["GET", "PUT", "HEAD"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600
    }]
  }
})).then(function () {
  console.log("R2 CORS를 설정했습니다: " + origins.join(", "));
}).catch(function (error) {
  console.error("R2 CORS를 설정하지 못했습니다. 키에 버킷 설정 권한이 있는지 확인해 주세요.");
  console.error(error.message);
  process.exit(1);
});
