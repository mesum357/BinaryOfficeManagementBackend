const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const tasksDir = path.join(uploadsDir, 'tasks');
if (!fs.existsSync(tasksDir)) {
  fs.mkdirSync(tasksDir, { recursive: true });
}

const chatDir = path.join(uploadsDir, 'chat');
if (!fs.existsSync(chatDir)) {
  fs.mkdirSync(chatDir, { recursive: true });
}

const documentsDir = path.join(uploadsDir, 'documents');
if (!fs.existsSync(documentsDir)) {
  fs.mkdirSync(documentsDir, { recursive: true });
}

const leavesDir = path.join(uploadsDir, 'leaves');
if (!fs.existsSync(leavesDir)) {
  fs.mkdirSync(leavesDir, { recursive: true });
}

// Configure storage for tasks
const taskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tasksDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `task-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// Configure storage for chat files
const chatStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, chatDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `chat-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// Configure storage for employee documents
const documentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, documentsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `doc-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// Configure storage for leave attachments
const leaveStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, leavesDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `leave-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// File filter for images only (for tasks)
const imageFileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
  }
};

// File filter for chat (images and documents)
const chatFileFilter = (req, file, cb) => {
  const allowedImageTypes = /jpeg|jpg|png|gif|webp/;
  const allowedDocTypes = /pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv/;
  const extname = path.extname(file.originalname).toLowerCase();
  const mimetype = file.mimetype;

  const isImage = allowedImageTypes.test(extname) && allowedImageTypes.test(mimetype);
  const isDocument = allowedDocTypes.test(extname) || mimetype.includes('application/pdf') ||
    mimetype.includes('application/msword') || mimetype.includes('application/vnd.openxmlformats-officedocument');

  if (isImage || isDocument) {
    return cb(null, true);
  } else {
    cb(new Error('Only image and document files are allowed!'));
  }
};

// Upload middleware for tasks (images only)
const upload = multer({
  storage: taskStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: imageFileFilter
});

// Upload middleware for chat (images and documents)
const chatUpload = multer({
  storage: chatStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: chatFileFilter
});

// Upload middleware for employee documents (images and PDFs)
const documentUpload = multer({
  storage: documentStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: chatFileFilter // Reusing chatFileFilter as it allows images and docs (including PDF)
});

// Upload middleware for leave attachments (images only)
const leaveUpload = multer({
  storage: leaveStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: imageFileFilter
});

module.exports = { upload, chatUpload, documentUpload, leaveUpload };

