function normalizeWhatsApp(value) {
  return String(value || "").replace(/\D/g, "");
}

function renderConfirmationMessage(template, tenantName) {
  return String(template || "").replaceAll("{tenant_name}", tenantName || "pesantren kami");
}

function buildTenantSubscriptionNotice(tenant, settings) {
  const warningDays = Number(settings.warning_days_before_due);
  const daysUntilDue = tenant.days_until_due == null ? null : Number(tenant.days_until_due);
  const billingEligible = ["active", "trial", "overdue"].includes(tenant.billing_status);
  const showWarning = tenant.status === "active"
    && billingEligible
    && Number.isInteger(daysUntilDue)
    && daysUntilDue >= 0
    && daysUntilDue <= warningDays;
  const whatsapp = normalizeWhatsApp(settings.billing_confirmation_whatsapp);
  const message = renderConfirmationMessage(
    settings.billing_confirmation_message_template,
    tenant.nama
  );

  return {
    subscription: {
      status: tenant.billing_status,
      amount: tenant.subscription_amount == null ? null : Number(tenant.subscription_amount),
      valid_from: tenant.subscription_started_at,
      valid_until: tenant.subscription_expires_at,
      days_until_due: daysUntilDue,
    },
    warning: {
      show: showWarning,
      days_before_due: warningDays,
      urgent: showWarning && daysUntilDue === 0,
    },
    payment: {
      bank_name: settings.billing_bank_name,
      account_number: settings.billing_account_number,
      account_holder: settings.billing_account_holder,
      instruction: settings.billing_payment_instruction,
      confirmation_whatsapp: whatsapp || null,
      confirmation_url: whatsapp && message
        ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`
        : null,
    },
  };
}

module.exports = {
  buildTenantSubscriptionNotice,
  normalizeWhatsApp,
  renderConfirmationMessage,
};
