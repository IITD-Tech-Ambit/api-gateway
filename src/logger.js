import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export function createLogger(level) {
    if (isProduction) {
        return pino({ level, name: 'api-gateway' });
    }

    return pino({
        level,
        name: 'api-gateway',
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname'
            }
        }
    });
}
