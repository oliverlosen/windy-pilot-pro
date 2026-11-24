import type { ExternalPluginConfig } from '@windy/interfaces';

const config: ExternalPluginConfig = {
    name: 'windy-plugin-pilot-pro',
    version: '1.3.0',
    icon: '🚁',
    title: 'Pilot Pro',
    description: 'Panel privado de meteorología para planificación de vuelo: viento, ráfagas, turbulencia, nubes, térmicas, lluvia, niveles y modelos de Windy.',
    author: 'Pilot Pro',
    desktopUI: 'rhpane',
    desktopWidth: 380,
    mobileUI: 'small',
    routerPath: '/pilot-pro',
    private: true,
};

export default config;
