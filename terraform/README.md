# Token broker deployment

Terraform owns the Google Cloud foundation and the Cloud Run runtime settings. The Cloud Run GitHub wizard owns the repository connection, build trigger, builds, and deployed container image. The wizard creates the initial Cloud Run service; Terraform imports it afterward.

## 1. Configure and apply the foundation

From this directory, authenticate Terraform with Application Default Credentials, then configure the project and OAuth client ID:

```sh
gcloud auth application-default login
cp terraform.tfvars.example terraform.tfvars
```

Set `project_id` in the ignored `terraform.tfvars`, then run:

```sh
terraform init
terraform apply
```

The default `manage_cloud_run_service = false` keeps Terraform from creating a Cloud Run service before the wizard. This first apply enables the APIs and creates the OAuth secret, a harmless placeholder version `1`, a runtime service account, and its secret access permission.

Add the real Google OAuth client secret as version `2`. Keep the value out of this repository and Terraform state:

```sh
gcloud secrets versions add google-oauth-client-secret \
  --data-file=/path/to/client-secret.txt \
  --project=YOUR_PROJECT_ID
```

For a different secret name, use the value of `google_oauth_client_secret_name` from `terraform.tfvars`.

## 2. Push the repository and use the Cloud Run wizard

Push this repository to GitHub. In Cloud Run, choose **Continuously deploy from a repository** and connect the repository through Developer Connect. Configure the build to use `token-broker` as its source/build directory so the build sees that folder's `package.json`.

Use these service settings in the wizard:

- Service name: `local-dashboard-token-broker` (or set `cloud_run_service_name` in `terraform.tfvars` to match your choice).
- Region: the same value as Terraform's `region` (default `northamerica-northeast1`, Montréal).
- Runtime service account: the email printed by Terraform as `token_broker_runtime_service_account`.
- Allow unauthenticated invocations. Terraform will track the `allUsers` invoker binding after import.
- Environment variable `GOOGLE_OAUTH_CLIENT_ID`: the configured public client ID.
- Environment variable `GOOGLE_OAUTH_CLIENT_SECRET`: select the existing Secret Manager secret and version `2`.

Let the wizard create the service, Artifact Registry repository, Developer Connect connection, and Cloud Build trigger. The initial commit/build should produce the first container image and revision.

## 3. Import the service and let Terraform own its runtime configuration

Set these values in `terraform.tfvars`:

```hcl
manage_cloud_run_service             = true
google_oauth_client_secret_version   = "2"
```

Then import the wizard-created service into the Terraform state. Use the exact service name and region chosen in the wizard:

```sh
terraform import 'google_cloud_run_v2_service.token_broker[0]' \
  projects/YOUR_PROJECT_ID/locations/northamerica-northeast1/services/local-dashboard-token-broker
```

Import the unauthenticated invocation binding too, since the wizard already adds it:

```sh
terraform import 'google_cloud_run_v2_service_iam_member.public_invoker[0]' \
  "projects/YOUR_PROJECT_ID/locations/northamerica-northeast1/services/local-dashboard-token-broker roles/run.invoker allUsers"
```

Run `terraform plan` and review it before applying. Terraform should converge the runtime identity, secret reference, ingress, and instance limit. The image is intentionally ignored, so Cloud Build can update it without Terraform reverting it. Terraform also manages public invocation access. Applying may create a new revision when it changes runtime settings.

If you chose a different service name or region, update `cloud_run_service_name` or `region` before import and use those same values in the import ID.

## Secret rotation

For later rotations, add a new Secret Manager version manually, update `google_oauth_client_secret_version`, then run `terraform apply`. Cloud Run will create a revision referencing that version. Keep the value itself out of Terraform inputs and state.

## Ownership and teardown

- Terraform: enabled APIs, Secret Manager secret and placeholder version, runtime service account and secret access, imported Cloud Run service settings, and public invoker access.
- Cloud Run wizard / Developer Connect / Cloud Build: GitHub connection, trigger, build settings and image deployments. Artifact Registry is created by the wizard.

Do not let Terraform manage the build trigger or image unless you deliberately move those resources into Terraform ownership. `terraform destroy` removes the Terraform-managed service and secret (including manually added secret versions), but does not remove the wizard-created trigger, repository connection, or Artifact Registry repository.
