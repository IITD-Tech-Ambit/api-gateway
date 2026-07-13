/**
 * TokenVerifier port — business logic depends on this shape, not on gRPC.
 *
 * @typedef {Object} VerifiedIdentity
 * @property {string} userId    IITD OAuth user_id (kerberos login id)
 * @property {string} email
 * @property {string} name
 * @property {string} kerberos
 * @property {string} department
 * @property {string} category
 *
 * @typedef {Object} VerifyResult
 * @property {boolean} valid
 * @property {VerifiedIdentity} [identity]  present when valid
 * @property {string} [error]               machine-readable reason when invalid
 *
 * @typedef {Object} TokenVerifier
 * @property {(token: string) => Promise<VerifyResult>} verify
 * @property {() => void} close
 */

export {}; // documentation-only module (JSDoc types)
