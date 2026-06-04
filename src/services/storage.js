const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const USE_S3 = !!process.env.AWS_S3_BUCKET;

let s3Client = null;

if (USE_S3) {
  s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

const BUCKET = process.env.AWS_S3_BUCKET;
const CDN_URL = process.env.CDN_URL; // CloudFront URL (opcional)

/**
 * Sube un archivo a S3 o lo deja en local (fallback para dev).
 * Retorna la URL pública del archivo.
 */
async function uploadFile(filePath, originalName, mimetype) {
  const ext = path.extname(originalName);
  const key = `challenges/${uuidv4()}${ext}`;

  if (USE_S3) {
    const fileBuffer = fs.readFileSync(filePath);

    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: mimetype,
    }));

    // Borrar archivo local después de subir
    fs.unlinkSync(filePath);

    // Retornar URL de CDN o S3 directo
    if (CDN_URL) {
      return `${CDN_URL}/${key}`;
    }
    return `https://${BUCKET}.s3.amazonaws.com/${key}`;
  }

  // Fallback local (dev)
  return `/uploads/${path.basename(filePath)}`;
}

/**
 * Genera una presigned URL para subida directa desde la app (opcional, para videos grandes).
 */
async function getUploadPresignedUrl(filename, mimetype) {
  if (!USE_S3) {
    return null;
  }

  const ext = path.extname(filename);
  const key = `challenges/${uuidv4()}${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: mimetype,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn: 300 }); // 5 min

  return { uploadUrl: url, fileUrl: CDN_URL ? `${CDN_URL}/${key}` : `https://${BUCKET}.s3.amazonaws.com/${key}` };
}

/**
 * Obtiene la URL pública de un archivo.
 * Si es local, devuelve el path relativo. Si es S3, devuelve la URL completa.
 */
function getPublicUrl(storedUrl) {
  if (!storedUrl) return null;
  // Si ya es una URL completa (S3/CDN), devolverla tal cual
  if (storedUrl.startsWith('http')) return storedUrl;
  // Si es local, construir URL completa con el host del backend
  return storedUrl;
}

module.exports = { uploadFile, getUploadPresignedUrl, getPublicUrl, USE_S3 };
