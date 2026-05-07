# Sovereign Customer Provisioning Checklist

This document outlines the steps to onboard a new Sovereign-tier customer
onto their own dedicated infrastructure. The InTellMe ingestion client is
compile-time excluded from Sovereign builds.

## Pre-requisites

- Customer contract signed (Sovereign onboarding fee collected via Stripe)
- Customer identifier chosen (short kebab-case, e.g. `acme-corp`)
- Target cloud region confirmed with customer
- BYOK encryption key generated for the customer's deployment

## Infrastructure Provisioning

1. **Copy Terraform template:**
   ```bash
   cp infra/sovereign/provision.example.tf infra/sovereign/customers/<customer-id>.tf
   ```

2. **Configure customer-specific variables** in the .tf file:
   - `customer_name` — customer identifier
   - `region` — deployment region
   - `db_instance_class` — sized per customer contract
   - VPC, subnet, and security group IDs for network isolation

3. **Apply infrastructure:**
   ```bash
   cd infra/sovereign
   terraform plan -var="customer_name=<customer-id>"
   terraform apply -var="customer_name=<customer-id>"
   ```

4. **Record outputs** (database URL, Redis URL, ECS cluster ARN).

## Database Setup

5. **Run migrations** against the customer's dedicated database:
   ```bash
   DATABASE_URL=<customer-db-url> npm run migrate
   ```

6. **Verify** the `user_tiers` table exists and `tier_addons` has the
   sovereign pricing rows.

## Application Deployment

7. **Build the Sovereign Docker image:**
   ```bash
   docker build -f infra/sovereign/Dockerfile.sovereign -t researchone:sovereign .
   ```

8. **Configure environment variables** for the customer's deployment:
   - `DEPLOYMENT_MODE=sovereign`
   - `EXCLUDE_INTELLME_CLIENT=true`
   - `DATABASE_URL=<customer-db-url>`
   - `REDIS_URL=<customer-redis-url>`
   - `BYOK_ENCRYPTION_KEY=<customer-specific-key>`
   - All other standard env vars (OpenRouter key, Clerk keys, etc.)

9. **Deploy** to the customer's ECS task / container service.

## Verification

10. **Health check:** `GET /health` returns 200.

11. **InTellMe exclusion:** Verify that no `pipeline_b_ingestion` jobs
    are enqueued during a test research run.

12. **Tier enforcement:** Verify that `tier=sovereign` users have
    `pipeline_b_eligible=false` regardless of consent settings.

13. **Data isolation:** The customer's database is fully separate from
    the B2C shared database. No cross-tenant data leakage is possible
    at the infrastructure level.

## Post-Provisioning

14. **Create the customer's admin user** in Clerk and assign
    `tier=sovereign` in `user_tiers`.

15. **Configure custom corpus adapter** if contracted (Sovereign add-on).

16. **Set up monitoring** (CloudWatch alarms, uptime checks).

17. **Document the customer** in the internal customer registry.

## Teardown

To deprovision a Sovereign customer:

1. Disable the ECS service (stop new tasks).
2. Export any data the customer has requested.
3. `terraform destroy -var="customer_name=<customer-id>"`
4. Delete the Clerk organization and user records.
5. Archive the customer's Terraform state.
