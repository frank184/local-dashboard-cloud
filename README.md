# Local Dashboard Cloud

Cloud-side services for Local Dashboard. The first service is a small Google OAuth token broker. Provider implementations stay separate while sharing one HTTP service, so Outlook can be added as another provider without creating a separate deployment for every integration.

## Token broker

See [`token-broker/README.md`](token-broker/README.md) for local configuration, API details, and Cloud Run deployment.

The broker exchanges Google authorization codes and refresh tokens, then returns Google’s token response to the desktop app. It does not persist tokens, OAuth codes, or user data. The desktop app remains responsible for encrypting and storing tokens locally.

## Deploy the token broker

See [`terraform/README.md`](terraform/README.md) for the deployment sequence. Terraform provisions the project foundation and runtime identity, the Cloud Run GitHub wizard connects the repository and creates the build/deploy trigger, then Terraform imports the service and manages its runtime settings while Cloud Build owns image updates.
