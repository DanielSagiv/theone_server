const Joi = require('joi');

/**
 * Authentication validation schemas
 * @description Joi validation schemas for authentication endpoints
 */

/**
 * User signup validation schema
 */
const signupSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  firstName: Joi.string().min(2).required(),
  lastName: Joi.string().min(2).required(),
  phone: Joi.string().min(10).required(),
  role: Joi.string().valid('admin', 'client', 'runner').default('client'),
  entity_status: Joi.string().valid('live', 'suspended', 'deleted', 'pendingApproval').default('pendingApproval')
});

/**
 * User signin validation schema
 */
const signinSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

/**
 * Password renewal validation schema
 */
const renewPasswordSchema = Joi.object({
  email: Joi.string().email().required()
});

/**
 * Password reset validation schema
 */
const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  newPassword: Joi.string().min(6).required()
});

/**
 * User profile update validation schema
 */
const updateProfileSchema = Joi.object({
  firstName: Joi.string().min(2),
  lastName: Joi.string().min(2),
  email: Joi.string().email(),
  phone: Joi.string().min(10),
  socialMedia: Joi.object({
    facebook: Joi.string().uri().allow(''),
    linkedin: Joi.string().uri().allow(''),
    x: Joi.string().uri().allow(''),
    instagram: Joi.string().uri().allow('')
  }).optional()
});

/**
 * Entity status update validation schema
 */
const updateEntityStatusSchema = Joi.object({
  entity_status: Joi.string().valid('live', 'suspended', 'deleted', 'pendingApproval').required()
});

const updateRoleSchema = Joi.object({
  role: Joi.string().valid('admin', 'client', 'runner').required()
});

module.exports = {
  signupSchema,
  signinSchema,
  renewPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  updateEntityStatusSchema,
  updateRoleSchema
};
