import { useEffect, useRef, useState } from "react";
import { Facebook, Instagram, Plus, RefreshCw } from "lucide-react";
import { useAuth } from "../../auth/AuthContext.jsx";
import AsyncDataSurface from "../../components/feedback/AsyncDataSurface.jsx";
import Modal from "../../components/feedback/Modal.jsx";
import Badge from "../../components/ui/Badge.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import { marketingService } from "./marketingService.js";
import {
  socialAccountStatus,
  socialCapabilities,
  socialReason,
  socialStateLabel,
} from "./socialAccountHealth.js";
import "./socialAccounts.css";
const stamp = (v) =>
  v
    ? new Intl.DateTimeFormat("en-MY", {
        timeZone: "Asia/Kuala_Lumpur",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(v))
    : "Not yet";
const tone = (s) =>
  ["verified", "operational"].includes(s)
    ? "success"
    : ["permission_required", "action_required", "expired"].includes(s)
      ? "warning"
      : "neutral";
const platform = (c) => (c === "facebook" ? "Facebook Page" : "Instagram");
export default function SocialAccounts({ organizationId, brandId, brands }) {
  const auth = useAuth(),
    configure = auth.hasPermission("marketing_settings.configure");
  const [data, setData] = useState(null),
    [configuration, setConfiguration] = useState(null),
    [pending, setPending] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState(null),
    [chosenBrand, setChosenBrand] = useState(""),
    [selected, setSelected] = useState([]),
    [confirmed, setConfirmed] = useState(false),
    [notifications, setNotifications] = useState(true);
  const lifetime = useRef(0),
    selectionKey = useRef(""),
    request = useRef(crypto.randomUUID());
  const scope = JSON.stringify([organizationId, brandId, auth.user?.id]);
  useEffect(() => {
    let live = true;
    lifetime.current++;
    setData(null);
    setPending([]);
    setLoading(true);
    setError("");
    setBusy(false);
    setModal(null);
    setSelected([]);
    setConfirmed(false);
    Promise.all([
      marketingService.metaConfiguration(),
      organizationId
        ? marketingService.socialAccounts(organizationId, brandId)
        : Promise.resolve({ connections: [] }),
      configure && organizationId && brandId
        ? marketingService.pendingMeta(organizationId, brandId)
        : Promise.resolve([]),
    ])
      .then(([config, accounts, sessions]) => {
        if (!live) return;
        setConfiguration(config);
        setData(accounts);
        setPending(sessions);
        if (sessions.length && selectionKey.current !== sessions[0].id) {
          selectionKey.current = sessions[0].id;
          setModal({ type: "select", session: sessions[0] });
          setSelected([]);
          setConfirmed(false);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      lifetime.current++;
    };
  }, [scope, configure, refresh]);
  async function perform(action, message, reload = true) {
    const generation = lifetime.current;
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (generation === lifetime.current) {
        setNotice(message);
        if (reload) {
          setModal(null);
          setRefresh((v) => v + 1);
        }
        return result;
      }
    } catch (e) {
      if (generation === lifetime.current) setError(e.message);
    } finally {
      if (generation === lifetime.current) setBusy(false);
    }
  }
  function openConnect(c = null) {
    setChosenBrand(c?.brand_id || brandId || "");
    setModal({ type: "connect", connection: c });
    setConfirmed(false);
  }
  async function launch() {
    const generation = lifetime.current;
    await perform(
      async () => {
        const result = await marketingService.authorizeMeta(
          organizationId,
          chosenBrand,
          modal.connection?.id,
        );
        if (generation !== lifetime.current) return;
        const url = new URL(result.authorization_url);
        if (url.protocol !== "https:" || url.hostname !== "www.facebook.com")
          throw new Error(
            "Meta authorization is unavailable. Try again later.",
          );
        window.location.assign(url.toString());
      },
      "Opening official Meta authorization.",
      false,
    );
  }
  const result = new URLSearchParams(window.location.search).get("meta_result");
  const accounts = data?.connections || [];
  const session = modal?.session;
  const selectedAssets =
    session?.accounts.filter((a) =>
      selected.includes(`${a.channel}:${a.id}`),
    ) || [];
  const chosenChannels = new Set(selectedAssets.map((a) => a.channel));
  const pairValid =
    selectedAssets.length < 2 ||
    selectedAssets.find((a) => a.channel === "instagram")?.page_id ===
      selectedAssets.find((a) => a.channel === "facebook")?.id;
  return (
    <section className="card social-accounts" aria-label="Social Accounts">
      <div className="social-accounts-heading">
        <div>
          <h2>Social Accounts</h2>
          <p>
            Connect Meta accounts to a FeedX brand. Publishing and replies stay
            separately controlled.
          </p>
        </div>
        {configure ? (
          <button
            className="btn-primary"
            disabled={
              loading ||
              busy ||
              !organizationId ||
              !brands.length ||
              !configuration?.configured
            }
            onClick={() => openConnect()}
          >
            <Plus size={15} />
            Connect Account
          </button>
        ) : null}
      </div>
      {notice ? (
        <p role="status" className="social-account-notice">
          {notice}
        </p>
      ) : null}
      {result && result !== "select_account" ? (
        <p role="status">
          {result === "cancelled"
            ? "Meta authorization was cancelled. Connect again when ready."
            : "Meta authorization did not finish. Connect again or ask your FeedX administrator to review app access."}
        </p>
      ) : null}
      <AsyncDataSurface
        loading={loading}
        error={error}
        hasData={!!data}
        onRetry={() => setRefresh((v) => v + 1)}
      >
        {configuration && !configuration.configured ? (
          <p>
            Social connections need FeedX administrator setup. API secrets and
            webhook settings are managed by FeedX.
          </p>
        ) : null}
        {result === "select_account" &&
        !pending.length &&
        !notice &&
        configuration?.configured ? (
          <p className="text-sm text-text-secondary">
            If you have just returned from Meta and no selection is available,
            it may have expired or no eligible Pages were shared. Connect again
            with the correct Page administrator.
          </p>
        ) : null}
        {pending.map((s) => (
          <div key={s.id} className="social-account-resume">
            <span>
              Authorized accounts are ready for brand confirmation · expires{" "}
              {stamp(s.expires_at)}
            </span>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                setModal({ type: "select", session: s });
                setSelected([]);
                setConfirmed(false);
              }}
            >
              Select accounts
            </button>
          </div>
        ))}
        {accounts.length ? (
          <div className="social-account-list">
            {accounts.map((c) => {
              const status = socialAccountStatus(c),
                capabilities = socialCapabilities(c),
                Icon = c.channel === "facebook" ? Facebook : Instagram;
              return (
                <article className="social-account" key={c.id}>
                  <div className="social-account-identity">
                    <Icon size={20} aria-label={platform(c.channel)} />
                    <div>
                      <h3>{c.account_name || platform(c.channel)}</h3>
                      <p>
                        {brands.find((b) => b.id === c.brand_id)?.name ||
                          "Authorized brand"}{" "}
                        · {platform(c.channel)}
                      </p>
                    </div>
                    <Badge tone={tone(status)}>
                      {socialStateLabel(status)}
                    </Badge>
                  </div>
                  <div className="social-account-capabilities">
                    {Object.entries(capabilities).map(([name, value]) => (
                      <div key={name}>
                        <span className="capitalize">{name}</span>
                        <Badge tone={tone(value.state)}>
                          {socialStateLabel(value.state)}
                        </Badge>
                        <p>{socialReason(value.reason)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="social-account-footer">
                    <p>
                      Last sync {stamp(c.last_synced_at)} · Checked{" "}
                      {stamp(c.health?.checked_at || c.last_checked_at)}
                      {c.sync_error_code ? " · Sync needs attention" : ""}
                      <br />
                      Publishing, staff replies and automatic replies retain
                      their existing approval and execution controls.
                    </p>
                    {configure ? (
                      <div className="social-account-actions">
                        <button
                          className="btn-secondary"
                          disabled={
                            busy ||
                            !configuration?.configured ||
                            c.status === "not_connected"
                          }
                          onClick={() =>
                            perform(
                              () => marketingService.refreshMetaHealth(c.id),
                              "Account status checked. No posts or messages were sent.",
                            )
                          }
                        >
                          <RefreshCw size={14} />
                          Refresh Status
                        </button>
                        <button
                          className="btn-secondary"
                          disabled={busy || !configuration?.configured}
                          onClick={() => openConnect(c)}
                        >
                          Reconnect
                        </button>
                        <button
                          className="btn-secondary"
                          disabled={
                            busy ||
                            !c.capabilities?.posts ||
                            ["expired", "not_connected"].includes(status)
                          }
                          onClick={() =>
                            perform(
                              () =>
                                c.status === "error"
                                  ? marketingService.retryMetaSync(c.id)
                                  : marketingService.syncMeta(c.id),
                              "Read-only synchronization requested.",
                            )
                          }
                        >
                          Sync posts
                        </button>
                        {capabilities.messaging.reason ===
                        "subscriptions_missing" ? (
                          <button
                            className="btn-secondary"
                            disabled={busy}
                            onClick={() =>
                              perform(
                                async () => {
                                  const checked =
                                    await marketingService.subscriptionPlan(
                                      c.id,
                                    );
                                  request.current = crypto.randomUUID();
                                  setModal({
                                    type: "subscriptions",
                                    connection: c,
                                    plan: checked.plan,
                                  });
                                  setConfirmed(false);
                                },
                                "Inbox installation checked.",
                                false,
                              )
                            }
                          >
                            Enable Inbox Updates
                          </button>
                        ) : null}
                        <button
                          className="btn-secondary"
                          disabled={busy || c.status === "not_connected"}
                          onClick={() =>
                            setModal({ type: "disconnect", connection: c })
                          }
                        >
                          Disconnect
                        </button>
                        <button
                          className="btn-secondary"
                          disabled={busy || c.status === "not_connected"}
                          onClick={() =>
                            perform(
                              async () => {
                                const value =
                                  await marketingService.diagnoseMeta(c.id);
                                setModal({ type: "diagnostics", value });
                              },
                              "Connection evidence checked.",
                              false,
                            )
                          }
                        >
                          Details
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p>
            No social accounts are connected. Select Connect Account to get
            started.
          </p>
        )}
      </AsyncDataSurface>
      {modal?.type === "connect" ? (
        <Modal
          title={
            modal.connection ? "Reconnect account" : "Connect Social Account"
          }
          onClose={() => {
            if (!busy) setModal(null);
          }}
          footer={
            <>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={busy || !chosenBrand || !confirmed}
                onClick={launch}
              >
                Continue to Meta
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <SelectField
              label="FeedX brand"
              value={chosenBrand}
              disabled={!!modal.connection || busy}
              onChange={setChosenBrand}
              searchable
              options={brands.map((b) => ({ value: b.id, label: b.name }))}
              placeholder="Select an existing brand"
            />
            {modal.connection ? (
              <p>
                Reconnect only {modal.connection.account_name}. Its brand and
                account identity stay fixed. Pending publishing work pauses and
                requires reauthorization.
              </p>
            ) : (
              <p>
                Use a Meta account authorized to manage this brand’s Page and
                linked Professional Instagram account. Choose the exact assets
                after authorization.
              </p>
            )}
            <label className="social-account-check">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I am authorized to connect these Meta accounts for the selected
              FeedX brand.
            </label>
            <p className="text-sm text-text-secondary">
              Meta may restrict access until FeedX has the necessary App Review
              and Advanced Access. Eligible accounts do not need tester-role or
              Accounts Center setup.
            </p>
          </div>
        </Modal>
      ) : null}
      {modal?.type === "select" ? (
        <Modal
          title="Select accounts & confirm brand"
          onClose={() => {
            if (!busy) setModal(null);
          }}
          footer={
            <>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Later
              </button>
              <button
                className="btn-primary"
                disabled={
                  busy ||
                  !confirmed ||
                  !selected.length ||
                  !pairValid ||
                  chosenChannels.size !== selectedAssets.length ||
                  Date.parse(session.expires_at) <= Date.now()
                }
                onClick={() =>
                  perform(
                    () =>
                      marketingService.bindMetaSelection(
                        session.id,
                        brandId,
                        selectedAssets.map((a) => ({
                          id: a.id,
                          channel: a.channel,
                          expectedConnectionId: a.current_connection_id ?? null,
                          expectedGeneration: a.current_generation ?? null,
                        })),
                        notifications,
                      ),
                    "Selected accounts connected. Capability checks completed or remain pending; execution was not enabled.",
                  )
                }
              >
                Confirm connection
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <p>
              FeedX brand:{" "}
              <strong>
                {brands.find((b) => b.id === brandId)?.name || "Selected brand"}
              </strong>
            </p>
            <p className="text-sm">
              Select one account per channel. Instagram must belong to the
              selected linked Page. Authorization expires{" "}
              {stamp(session.expires_at)}.
            </p>
            {!session.accounts.length ? (
              <p>
                No eligible Page was shared by Meta. Connect again with a Page
                administrator; your FeedX administrator can review app access if
                needed.
              </p>
            ) : (
              session.accounts.map((a) => (
                <label
                  className="social-account-choice"
                  key={`${a.channel}:${a.id}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(`${a.channel}:${a.id}`)}
                    disabled={busy || a.available === false}
                    onChange={(e) =>
                      setSelected((v) =>
                        e.target.checked
                          ? [
                              ...v.filter(
                                (k) => !k.startsWith(`${a.channel}:`),
                              ),
                              `${a.channel}:${a.id}`,
                            ]
                          : v.filter((k) => k !== `${a.channel}:${a.id}`),
                      )
                    }
                  />
                  <span>
                    <strong>{a.name}</strong>
                    <small>
                      {platform(a.channel)} · Account {a.id}
                      {a.page_id ? ` · Linked Page ${a.page_id}` : ""}
                    </small>
                    {a.available === false ? (
                      <small>
                        Already owned by another FeedX brand; cannot be assigned
                        here.
                      </small>
                    ) : a.replacement ? (
                      <small>
                        Replaces this brand’s current {platform(a.channel)}.
                        Pending work pauses and requires reauthorization.
                      </small>
                    ) : null}
                  </span>
                </label>
              ))
            )}
            {!pairValid ? (
              <p role="alert">
                Choose the Page linked to the selected Instagram account.
              </p>
            ) : null}
            <label className="social-account-check">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I confirm that the exact selected accounts belong to this FeedX
              brand.
            </label>
            <label className="social-account-check">
              <input
                type="checkbox"
                checked={notifications}
                disabled={busy}
                onChange={(e) => setNotifications(e.target.checked)}
              />
              Install eligible Inbox updates for these accounts using FeedX’s
              existing Meta app. This receives notifications; it does not send
              replies.
            </label>
            <p className="text-sm text-text-secondary">
              Unavailable permissions remain unavailable. Publishing, outbound
              replies and AI automatic replies will not be activated.
            </p>
          </div>
        </Modal>
      ) : null}
      {modal?.type === "disconnect" ? (
        <Modal
          title="Disconnect account"
          onClose={() => {
            if (!busy) setModal(null);
          }}
          footer={
            <>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() =>
                  perform(
                    () => marketingService.disconnectMeta(modal.connection.id),
                    "Account disconnected from FeedX. Its encrypted credentials were removed.",
                  )
                }
              >
                Disconnect account
              </button>
            </>
          }
        >
          <p>
            Disconnect {modal.connection.account_name} from{" "}
            {brands.find((b) => b.id === modal.connection.brand_id)?.name}. This
            removes its FeedX credentials and stops affected scheduled
            execution. Existing approvals do not authorize a replacement
            account. Uncertain delivery stays visible. Other brands and content
            already on Meta are unchanged.
          </p>
        </Modal>
      ) : null}
      {modal?.type === "subscriptions" ? (
        <Modal
          title="Enable Inbox Updates"
          onClose={() => {
            if (!busy) setModal(null);
          }}
          footer={
            <>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={busy || !confirmed || !modal.plan.eligible}
                onClick={() =>
                  perform(async () => {
                    const outcome =
                      await marketingService.installMetaSubscriptions(
                        modal.connection.id,
                        request.current,
                        {
                          page_id: modal.plan.page_id,
                          fields: modal.plan.fields,
                        },
                      );
                    if (outcome.state !== "verified")
                      throw new Error(
                        "Installation is awaiting Meta confirmation. Refresh status; do not repeat an uncertain installation.",
                      );
                  }, "Inbox updates verified. Replies remain separately controlled.")
                }
              >
                Confirm installation
              </button>
            </>
          }
        >
          <p>
            Receive messaging notifications for {modal.connection.account_name}{" "}
            through the existing FeedX app. Existing subscriptions are
            preserved. No customer message will be sent.
          </p>
          <p>{socialReason(modal.plan.reason)}</p>
          <label className="social-account-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I approve installing Inbox updates for this exact account.
          </label>
        </Modal>
      ) : null}
      {modal?.type === "diagnostics" ? (
        <Modal title="Connection evidence" onClose={() => setModal(null)}>
          <pre className="social-account-diagnostics">
            {JSON.stringify(modal.value, null, 2)}
          </pre>
        </Modal>
      ) : null}
    </section>
  );
}
