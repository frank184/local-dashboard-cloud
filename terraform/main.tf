terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

variable "project_id" {
  description = "Google Cloud project ID for Local Dashboard Cloud."
  type        = string
}

variable "region" {
  description = "Cloud Run region."
  type        = string
  default     = "us-east1"
}

variable "google_oauth_client_id" {
  description = "Public Google OAuth client ID used by Local Dashboard."
  type        = string
}

variable "google_oauth_client_secret_name" {
  description = "Secret Manager secret Terraform creates for the Google OAuth client secret."
  type        = string
  default     = "google-oauth-client-secret"
}

variable "google_oauth_client_secret_version" {
  description = "Secret version mounted by Cloud Run. Use 1 for the placeholder, then set the real version number."
  type        = string
  default     = "1"
}

variable "manage_cloud_run_service" {
  description = "Enable after the Cloud Run wizard creates the service; import it before applying."
  type        = bool
  default     = false
}

variable "cloud_run_service_name" {
  description = "Cloud Run service name created by the GitHub deployment wizard."
  type        = string
  default     = "local-dashboard-token-broker"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  required_apis = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "developerconnect.googleapis.com",
    "iam.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
  ])
}

resource "google_project_service" "required" {
  for_each           = local.required_apis
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_secret_manager_secret" "google_oauth_client_secret" {
  project   = var.project_id
  secret_id = var.google_oauth_client_secret_name

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

# Harmless bootstrap value. Add the real credential as a new version manually;
# the real value must never be placed in Terraform variables or state.
resource "google_secret_manager_secret_version" "client_secret_placeholder" {
  secret      = google_secret_manager_secret.google_oauth_client_secret.name
  secret_data = "REPLACE_WITH_GOOGLE_OAUTH_CLIENT_SECRET"
}

resource "google_service_account" "token_broker" {
  project      = var.project_id
  account_id   = "local-dashboard-token-broker"
  display_name = "Local Dashboard token broker"
}

resource "google_secret_manager_secret_iam_member" "client_secret_access" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.google_oauth_client_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.token_broker.email}"
}

# The Cloud Run wizard creates the service and build trigger. After importing
# the service, Terraform owns its runtime configuration while Cloud Build owns
# the image deployed on each commit.
resource "google_cloud_run_v2_service" "token_broker" {
  count = var.manage_cloud_run_service ? 1 : 0

  project             = var.project_id
  name                = var.cloud_run_service_name
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.token_broker.email

    scaling {
      max_instance_count = 3
    }

    containers {
      # Cloud Build supplies the real image. This field is intentionally ignored
      # so Terraform does not roll deployments back to an older image.
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      env {
        name  = "GOOGLE_OAUTH_CLIENT_ID"
        value = var.google_oauth_client_id
      }

      env {
        name = "GOOGLE_OAUTH_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_oauth_client_secret.secret_id
            version = var.google_oauth_client_secret_version
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_version.client_secret_placeholder,
    google_secret_manager_secret_iam_member.client_secret_access,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count = var.manage_cloud_run_service ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = var.cloud_run_service_name
  role     = "roles/run.invoker"
  member   = "allUsers"

  depends_on = [google_cloud_run_v2_service.token_broker]
}

output "token_broker_url" {
  description = "Public base URL for the Local Dashboard token broker. Available after importing the wizard-created service."
  value       = var.manage_cloud_run_service ? google_cloud_run_v2_service.token_broker[0].uri : null
}

output "token_broker_runtime_service_account" {
  description = "Select this service account in the Cloud Run wizard."
  value       = google_service_account.token_broker.email
}

output "google_oauth_client_secret_name" {
  description = "Secret name to select in the Cloud Run wizard."
  value       = google_secret_manager_secret.google_oauth_client_secret.secret_id
}
