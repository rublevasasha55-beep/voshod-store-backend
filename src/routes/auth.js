import { Router } from 'express';
import { sendOtp, verifyAndRegister, login, getMe } from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

router.post('/send-otp',            sendOtp);
router.post('/verify-and-register', verifyAndRegister);
router.post('/login',               login);
router.get('/me',                   authenticate, getMe);

export default router;
