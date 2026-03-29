const express = require("express");
const router = express.Router();
const { 
  PutItemCommand, 
  GetItemCommand, 
  ScanCommand, 
  QueryCommand 
} = require("@aws-sdk/client-dynamodb");
const { PublishCommand } = require("@aws-sdk/client-sns");
const { snsClient, dynamoClient, s3Client } = require("../config/awsConfig");
const multer = require("multer");
const multerS3 = require("multer-s3");
require("dotenv").config();

// Temporary in-memory OTP storage
const otps = {};

// S3 Upload configuration for Multiple Files
const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET_NAME,
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      const folder = file.fieldname === 'profilePhoto' ? 'profile' : 'docs';
      const fileName = `drivers/${folder}/${Date.now().toString()}-${file.originalname}`;
      cb(null, fileName);
    }
  })
}).fields([
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'dlFront', maxCount: 1 },
  { name: 'dlBack', maxCount: 1 },
  { name: 'rcFront', maxCount: 1 },
  { name: 'insuranceFront', maxCount: 1 },
  { name: 'fcFront', maxCount: 1 },
  { name: 'permitFront', maxCount: 1 }
]);

// 1. Check Mobile Status
router.post("/check-status", async (req, res) => {
  const { phone } = req.body;
  
  try {
    const params = {
      TableName: process.env.DYNAMODB_TABLE_DRIVERS,
      Key: {
        driverId: { S: phone }
      }
    };
    
    const { Item } = await dynamoClient.send(new GetItemCommand(params));
    
    if (Item) {
      res.json({ 
        exists: true, 
        status: Item.status?.S || "PENDING_REVIEW",
        message: Item.status?.S === "PENDING_REVIEW" ? "Your application is under review." : "Existing driver found."
      });
    } else {
      res.json({ exists: false, status: "NOT_FOUND" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Send OTP (SNS with Auto-fetch format)
router.post("/send-otp", async (req, res) => {
  const { phone, appHash } = req.body; // appHash required for auto-fetch
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // In a real app, store OTP in Redis/Dynamo with TTL
  console.log(`[OTP] Generated for ${phone}: ${otp}`);

  const message = `<#> Your U-Turn OTP is ${otp}.\n${appHash || ""}`;
  
  try {
    otps[phone] = otp; // Store OTP for verification
    await snsClient.send(new PublishCommand({
      Message: message,
      PhoneNumber: `+91${phone}`
    }));
    res.json({ success: true, message: "OTP sent successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2.1 Verify OTP
router.post("/verify-otp", async (req, res) => {
  const { phone, otp } = req.body;
  
  if (otps[phone] && otps[phone] === otp) {
    delete otps[phone]; // Clear after success
    res.json({ success: true, message: "OTP verified successfully." });
  } else {
    res.status(400).json({ success: false, message: "Invalid OTP." });
  }
});

// 3. Check Aadhaar Existence
router.post("/check-aadhar", async (req, res) => {
  const { aadhar } = req.body;
  
  try {
    const params = {
      TableName: process.env.DYNAMODB_TABLE_DRIVERS,
      FilterExpression: "aadhar = :a",
      ExpressionAttributeValues: {
        ":a": { S: aadhar }
      }
    };
    
    const { Items } = await dynamoClient.send(new ScanCommand(params));
    
    if (Items && Items.length > 0) {
      res.json({ exists: true, message: "Aadhaar already exists. Please login." });
    } else {
      res.json({ exists: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Register Driver
router.post("/register", upload, async (req, res) => {
  const driverData = JSON.parse(req.body.driverData);
  const files = req.files;

  try {
    const params = {
      TableName: process.env.DYNAMODB_TABLE_DRIVERS,
      Item: {
        driverId: { S: driverData.phone },
        name: { S: driverData.name },
        phone: { S: driverData.phone },
        aadhar: { S: driverData.aadhar },
        dob: { S: driverData.dob },
        state: { S: driverData.state },
        licenceNumber: { S: driverData.licenceNumber },
        licenceExpiry: { S: driverData.licenceExpiry },
        vehicleNumber: { S: driverData.vehicleNumber },
        vehicleType: { S: driverData.vehicleType },
        status: { S: "PENDING_REVIEW" },
        profilePhoto: { S: files.profilePhoto ? files.profilePhoto[0].location : "" },
        aadhaarFront: { S: files.aadhaarFront ? files.aadhaarFront[0].location : "" },
        dlFront: { S: files.dlFront ? files.dlFront[0].location : "" },
        dlBack: { S: files.dlBack ? files.dlBack[0].location : "" },
        rcFront: { S: files.rcFront ? files.rcFront[0].location : "" },
        insuranceFront: { S: files.insuranceFront ? files.insuranceFront[0].location : "" },
        fcFront: { S: files.fcFront ? files.fcFront[0].location : "" },
        permitFront: { S: files.permitFront ? files.permitFront[0].location : "" },
        createdAt: { S: new Date().toISOString() }
      }
    };
    
    await dynamoClient.send(new PutItemCommand(params));
    res.json({ success: true, message: "Registration submitted for review." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
