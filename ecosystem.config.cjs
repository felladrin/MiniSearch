// eslint-disable-next-line no-undef
module.exports = {
  apps: [
    {
      name: "production-server",
      script: "npm",
      args: "start -- --host",
      instances: "max",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
