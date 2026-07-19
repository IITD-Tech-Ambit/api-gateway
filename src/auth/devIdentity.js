/**
 * Stable mock identity used only when ENABLE_AUTH=false. Shape matches the
 * VerifiedIdentity produced by GrpcTokenVerifier so bypassed requests inject
 * the same trusted x-user-* headers as a real IITD OAuth session.
 *
 * @type {import('../ports/tokenVerifier.js').VerifiedIdentity}
 */
export const DEV_IDENTITY = Object.freeze({
    userId: 'devuser',
    email: 'devuser@iitd.ac.in',
    name: 'Dev User',
    kerberos: 'devuser',
    department: 'Computer Science and Engineering',
    category: 'student'
});
