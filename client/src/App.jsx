import { useCallback, useEffect, useState } from "react";
import {
  getDocuments,
  uploadDocument,
  downloadDocument,
  renameDocument,
  deleteDocument,
  getUsers,
  getDocumentGrants,
  grantDocumentAccess,
  revokeDocumentAccess,
  getAuditLogs,
} from "./api";
import "./App.css";

const API_URL =
  (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "") + "/api";

function App() {
  const [user, setUser] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("General");
  const [activeView, setActiveView] = useState("Overview");
  const [search, setSearch] = useState("");

  const [users, setUsers] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [permission, setPermission] = useState("read");
  const [grants, setGrants] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingGrants, setLoadingGrants] = useState(false);
  const [savingGrant, setSavingGrant] = useState(false);
  const [changingGrantUserId, setChangingGrantUserId] = useState("");
  const [revokingUserId, setRevokingUserId] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState("");

  const isAdmin =
    String(user?.role || "").toLowerCase() === "admin";

  const safeDocuments = Array.isArray(documents) ? documents : [];
  const safeUsers = Array.isArray(users) ? users : [];
  const safeGrants = Array.isArray(grants) ? grants : [];
  const safeAuditLogs = Array.isArray(auditLogs) ? auditLogs : [];

  const filteredDocuments = safeDocuments.filter((document) => {
    const query = search.trim().toLowerCase();

    return (
      String(document.name || "").toLowerCase().includes(query) ||
      String(document.category || "").toLowerCase().includes(query)
    );
  });

  const totalSize = safeDocuments.reduce(
    (total, document) => total + (Number(document.size) || 0),
    0
  );

  const manageableDocuments = safeDocuments.filter(
    (document) =>
      user &&
      (isAdmin ||
        String(user.role || "").toLowerCase() === "owner" ||
        String(document.owner_id ?? document.ownerId) ===
          String(user.id))
  );

  const availableUsers = safeUsers.filter(
    (item) => String(item.id) !== String(user?.id)
  );

  function handleReturnToLogin() {
    window.location.assign("/login");
  }

  // Check the authenticated session and load documents.
  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const response = await fetch(`${API_URL}/auth/me`, {
          credentials: "include",
        });

        if (!response.ok) {
          if (active) {
            setUser(null);
            setDocuments([]);
          }
          return;
        }

        const data = await response.json();

        if (!active) return;

        if (!data.user) {
          setUser(null);
          setDocuments([]);
          return;
        }

        setUser(data.user);

        const result = await getDocuments();

        if (!active) return;

        if (!Array.isArray(result)) {
          throw new Error(
            "The documents API returned an unexpected response."
          );
        }

        setDocuments(result);
      } catch (err) {
        if (active) {
          setError(
            err.message ||
              "Cannot connect to TrustVault. Check that the backend is running."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    initialize();

    return () => {
      active = false;
    };
  }, []);

  const loadDocuments = useCallback(async () => {
    try {
      setError("");

      const result = await getDocuments();

      if (!Array.isArray(result)) {
        throw new Error(
          "The documents API returned an unexpected response."
        );
      }

      setDocuments(result);
    } catch (err) {
      setError(err.message || "Could not load documents.");
    }
  }, []);

  // Load the user directory whenever the Sharing view opens.
  useEffect(() => {
    if (activeView !== "Sharing" || !user) return;

    let cancelled = false;

    async function loadSharingUsers() {
      setLoadingUsers(true);

      try {
        const result = await getUsers();

        if (!Array.isArray(result)) {
          throw new Error(
            "The users API returned an unexpected response."
          );
        }

        if (!cancelled) {
          setUsers(result);
          setSelectedUserId((currentId) => {
            const stillAvailable = result.some(
              (item) =>
                String(item.id) === String(currentId) &&
                String(item.id) !== String(user.id)
            );

            return stillAvailable ? currentId : "";
          });
        }
      } catch (err) {
        if (!cancelled) {
          setUsers([]);
          setSelectedUserId("");
          setError(err.message || "Could not load users.");
        }
      } finally {
        if (!cancelled) {
          setLoadingUsers(false);
        }
      }
    }

    loadSharingUsers();

    return () => {
      cancelled = true;
    };
  }, [activeView, user]);

  const loadGrants = useCallback(async (documentId) => {
    if (!documentId) {
      setGrants([]);
      return;
    }

    try {
      setLoadingGrants(true);

      const result = await getDocumentGrants(documentId);

      setGrants(Array.isArray(result) ? result : []);
    } catch (err) {
      setGrants([]);
      setError(
        err.message || "Could not load sharing permissions."
      );
    } finally {
      setLoadingGrants(false);
    }
  }, []);

  useEffect(() => {
    if (
      activeView === "Sharing" &&
      selectedDocumentId &&
      user
    ) {
      loadGrants(selectedDocumentId);
    } else if (!selectedDocumentId) {
      setGrants([]);
    }
  }, [activeView, selectedDocumentId, user, loadGrants]);

  const loadAuditLogs = useCallback(async () => {
    if (!isAdmin) {
      setAuditLogs([]);
      setAuditError("Only administrators can view audit logs.");
      return;
    }

    try {
      setLoadingAudit(true);
      setAuditError("");

      const result = await getAuditLogs();

      if (!Array.isArray(result)) {
        throw new Error(
          "The audit API returned an unexpected response."
        );
      }

      setAuditLogs(result);
    } catch (err) {
      setAuditError(
        err.message || "Could not load audit logs."
      );
    } finally {
      setLoadingAudit(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (activeView !== "Activity" || !user) return;

    if (!isAdmin) {
      setAuditLogs([]);
      setAuditError("Only administrators can view audit logs.");
      return;
    }

    loadAuditLogs();
  }, [activeView, user, isAdmin, loadAuditLogs]);

  async function handleUpload(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const file = form.elements.file?.files?.[0];

    if (!file) {
      setError("Please choose a file to upload.");
      return;
    }

    try {
      setUploading(true);
      setError("");
      setMessage("");

      await uploadDocument(file, category);

      form.reset();
      setCategory("General");
      setMessage("Document uploaded successfully.");

      await loadDocuments();
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(document) {
    try {
      setError("");
      setMessage("");

      await downloadDocument(document.id, document.name);

      setMessage(`Download started: ${document.name}`);
    } catch (err) {
      setError(err.message || "Download failed.");
    }
  }

  async function handleRename(document) {
    const name = window.prompt(
      "Enter the new document name:",
      document.name
    );

    if (name === null) return;

    if (!name.trim()) {
      setError("Document name cannot be empty.");
      return;
    }

    try {
      setError("");
      setMessage("");

      await renameDocument(document.id, name.trim());

      setMessage("Document renamed successfully.");

      await loadDocuments();
    } catch (err) {
      setError(err.message || "Rename failed.");
    }
  }

  async function handleDelete(document) {
    if (
      !window.confirm(
        `Are you sure you want to delete "${document.name}"?`
      )
    ) {
      return;
    }

    try {
      setError("");
      setMessage("");

      await deleteDocument(document.id);

      if (String(selectedDocumentId) === String(document.id)) {
        setSelectedDocumentId("");
        setGrants([]);
      }

      setMessage("Document deleted successfully.");

      await loadDocuments();
    } catch (err) {
      setError(err.message || "Delete failed.");
    }
  }

  async function handleLogout() {
    if (loggingOut) return;

    setLoggingOut(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));

        setError(
          data.error ||
            data.message ||
            "Logout failed. Please try again."
        );
        return;
      }

      setUser(null);
      setDocuments([]);
      setUsers([]);
      setGrants([]);
      setAuditLogs([]);
      setSelectedDocumentId("");
      setSelectedUserId("");

      window.location.assign("/login");
    } catch {
      setError(
        "Cannot connect to the server. Please try again."
      );
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleShare(event) {
    event.preventDefault();

    if (!selectedDocumentId || !selectedUserId) {
      setError("Please select a document and a user.");
      return;
    }

    if (
      !availableUsers.some(
        (item) => String(item.id) === String(selectedUserId)
      )
    ) {
      setError(
        "The selected user is no longer available. Refresh the user list."
      );
      return;
    }

    const existingGrant = safeGrants.find(
      (grant) =>
        String(grant.userId ?? grant.user_id) ===
        String(selectedUserId)
    );

    if (existingGrant) {
      setError(
        "This user already has access. Change their permission in the list below."
      );
      return;
    }

    try {
      setSavingGrant(true);
      setError("");
      setMessage("");

      await grantDocumentAccess(
        selectedDocumentId,
        selectedUserId,
        permission
      );

      const selectedUser = availableUsers.find(
        (item) => String(item.id) === String(selectedUserId)
      );

      setMessage(
        `Access granted to ${selectedUser?.name || "the selected user"}.`
      );

      await loadGrants(selectedDocumentId);
    } catch (err) {
      setError(
        err.message || "Could not grant document access."
      );
    } finally {
      setSavingGrant(false);
    }
  }

  async function handlePermissionChange(grant, newPermission) {
    if (grant.permission === newPermission) return;

    const grantUserId = grant.userId ?? grant.user_id;

    try {
      setChangingGrantUserId(String(grantUserId));
      setError("");
      setMessage("");

      await grantDocumentAccess(
        selectedDocumentId,
        grantUserId,
        newPermission
      );

      setMessage(
        `Permission updated to ${newPermission.toUpperCase()}.`
      );

      await loadGrants(selectedDocumentId);
    } catch (err) {
      setError(
        err.message || "Could not update permission."
      );
    } finally {
      setChangingGrantUserId("");
    }
  }

  async function handleRevoke(grant) {
    const grantUserId = grant.userId ?? grant.user_id;
    const grantName = grant.name || grant.email || "this user";

    if (
      !window.confirm(
        `Revoke ${grantName}'s access to this document?`
      )
    ) {
      return;
    }

    try {
      setRevokingUserId(String(grantUserId));
      setError("");
      setMessage("");

      await revokeDocumentAccess(
        selectedDocumentId,
        grantUserId
      );

      setMessage(`Access revoked for ${grantName}.`);

      await loadGrants(selectedDocumentId);
    } catch (err) {
      setError(
        err.message || "Could not revoke document access."
      );
    } finally {
      setRevokingUserId("");
    }
  }

  if (loading) {
    return (
      <main className="loading-screen">
        <div className="loading-brand">
          <span className="brand-icon">T</span>
          <span>TrustVault</span>
        </div>
        <p>Preparing your secure workspace...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="login-fallback">
        <section className="fallback-card">
          <span className="brand-icon">T</span>
          <h1>TrustVault</h1>
          <p>
            {loggingOut
              ? "Logging out securely..."
              : "Your session has ended. Please log in to continue."}
          </p>

          {error && (
            <p className="error-message">{error}</p>
          )}

          {!loggingOut && (
            <button
              type="button"
              onClick={handleReturnToLogin}
            >
              Return to login
            </button>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="vault-layout">
      <aside className="sidebar">
        <a className="sidebar-brand" href="#overview">
          <span className="brand-icon">T</span>
          <span>
            <strong>TrustVault</strong>
            <small>SECURE WORKSPACE</small>
          </span>
        </a>

        <div className="sidebar-label">WORKSPACE</div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <button
            type="button"
            className={
              activeView === "Overview"
                ? "nav-item active"
                : "nav-item"
            }
            onClick={() => setActiveView("Overview")}
          >
            <span className="nav-icon">▦</span>
            Overview
          </button>

          <button
            type="button"
            className={
              activeView === "Documents"
                ? "nav-item active"
                : "nav-item"
            }
            onClick={() => setActiveView("Documents")}
          >
            <span className="nav-icon">▤</span>
            My documents
            <span className="nav-count">
              {safeDocuments.length}
            </span>
          </button>

          <button
            type="button"
            className={
              activeView === "Sharing"
                ? "nav-item active"
                : "nav-item"
            }
            onClick={() => {
              setActiveView("Sharing");
              setMessage("");
              setError("");
            }}
          >
            <span className="nav-icon">⇄</span>
            Sharing
          </button>

          <button
            type="button"
            className={
              activeView === "Activity"
                ? "nav-item active"
                : "nav-item"
            }
            onClick={() => {
              setActiveView("Activity");
              setMessage("");
              setError("");
              setAuditError("");
            }}
          >
            <span className="nav-icon">◷</span>
            Audit activity
          </button>
        </nav>

        <div className="sidebar-spacer" />

        <div className="security-card">
          <div className="security-card-icon">✓</div>
          <strong>Security matters</strong>
          <p>
            Your workspace uses authenticated access and permission checks.
          </p>
          <span className="security-status">
            <span /> Session active
          </span>
        </div>

        <button
          type="button"
          className="sidebar-logout"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          <span>↪</span>{" "}
          {loggingOut ? "Logging out..." : "Log out"}
        </button>

        <div className="sidebar-version">
          TRUSTVAULT · LOCAL WORKSPACE
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{activeView}</strong>
          </div>

          <div className="topbar-right">
            <div className="topbar-security">
              <span>●</span> Secure session
            </div>

            <div className="avatar">
              {(user.name || "U").charAt(0).toUpperCase()}
            </div>

            <div className="topbar-user">
              <strong>{user.name}</strong>
              <span>{user.role}</span>
            </div>
          </div>
        </header>

        <div className="page-content">
          {error && (
            <div className="notice error-message" role="alert">
              <span>!</span> {error}
              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          {message && (
            <div className="notice success-message" role="status">
              <span>✓</span> {message}
              <button
                type="button"
                onClick={() => setMessage("")}
                aria-label="Dismiss message"
              >
                ×
              </button>
            </div>
          )}

          {activeView === "Overview" && (
            <>
              <section className="welcome-row" id="overview">
                <div>
                  <div className="eyebrow">
                    <span className="eyebrow-dot" />
                    YOUR PRIVATE WORKSPACE
                  </div>

                  <h1>
                    Good to see you,{" "}
                    {user.name?.split(" ")[0] || "there"}.
                  </h1>

                  <p>
                    Manage your files and keep your important documents
                    in one secure place.
                  </p>
                </div>

                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    document.getElementById("file-upload")?.click()
                  }
                >
                  <span>＋</span> Upload document
                </button>
              </section>

              <section className="stats-grid">
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Total documents</span>
                    <span className="stat-icon purple">▤</span>
                  </div>
                  <div className="stat-value">
                    {safeDocuments.length}
                  </div>
                  <div className="stat-caption">
                    Files you can access
                  </div>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span>Storage used</span>
                    <span className="stat-icon blue">◫</span>
                  </div>
                  <div className="stat-value">
                    {totalSize >= 1024 * 1024
                      ? `${(totalSize / (1024 * 1024)).toFixed(2)} MB`
                      : `${(totalSize / 1024).toFixed(1)} KB`}
                  </div>
                  <div className="stat-caption">
                    Based on listed file sizes
                  </div>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span>Account role</span>
                    <span className="stat-icon green">♙</span>
                  </div>
                  <div className="stat-value role-value">
                    {user.role || "Member"}
                  </div>
                  <div className="stat-caption">
                    Current access level
                  </div>
                </article>
              </section>

              <section className="panel upload-panel" id="upload">
                <div className="panel-heading">
                  <div className="heading-icon">↑</div>
                  <div>
                    <h2>Upload a document</h2>
                    <p>Add a file to your secure workspace.</p>
                  </div>
                </div>

                <form className="upload-form" onSubmit={handleUpload}>
                  <label className="file-picker">
                    <span className="file-picker-icon">↑</span>
                    <span className="file-picker-copy">
                      <strong>Choose a file to upload</strong>
                      <small>
                        PDF, TXT, PNG or JPEG · Up to 10 MB
                      </small>
                    </span>
                    <span className="browse-button">Browse files</span>
                    <input
                      id="file-upload"
                      type="file"
                      name="file"
                      accept=".pdf,.txt,.png,.jpg,.jpeg,application/pdf,text/plain,image/png,image/jpeg"
                      required
                    />
                  </label>

                  <label className="category-field">
                    <span>Document category</span>
                    <select
                      value={category}
                      onChange={(event) =>
                        setCategory(event.target.value)
                      }
                    >
                      <option>General</option>
                      <option>Work</option>
                      <option>Personal</option>
                      <option>Finance</option>
                      <option>Other</option>
                    </select>
                  </label>

                  <button
                    className="primary-button upload-submit"
                    type="submit"
                    disabled={uploading}
                  >
                    {uploading ? "Uploading..." : "↑ Upload document"}
                  </button>
                </form>
              </section>

              <section className="panel documents-panel">
                <div className="section-heading">
                  <div>
                    <h2>Recent documents</h2>
                    <p>Quick access to your available files.</p>
                  </div>

                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setActiveView("Documents")}
                  >
                    View all documents →
                  </button>
                </div>

                <DocumentList
                  documents={safeDocuments.slice(0, 4)}
                  user={user}
                  onDownload={handleDownload}
                  onRename={handleRename}
                  onDelete={handleDelete}
                />
              </section>
            </>
          )}

          {activeView === "Documents" && (
            <>
              <section className="view-heading">
                <div>
                  <div className="eyebrow">
                    <span className="eyebrow-dot" />
                    FILE MANAGEMENT
                  </div>

                  <h1>My documents</h1>
                  <p>
                    Find and manage the documents available to your account.
                  </p>
                </div>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={loadDocuments}
                >
                  ↻ Refresh
                </button>
              </section>

              <section className="panel documents-panel">
                <div className="section-heading document-toolbar">
                  <div>
                    <h2>All documents</h2>
                    <p>
                      {safeDocuments.length} files available
                    </p>
                  </div>

                  <input
                    className="search-input"
                    type="search"
                    placeholder="Search documents..."
                    value={search}
                    onChange={(event) =>
                      setSearch(event.target.value)
                    }
                  />
                </div>

                <DocumentList
                  documents={filteredDocuments}
                  user={user}
                  onDownload={handleDownload}
                  onRename={handleRename}
                  onDelete={handleDelete}
                />
              </section>
            </>
          )}

          {activeView === "Sharing" && (
            <>
              <section className="view-heading">
                <div>
                  <div className="eyebrow">
                    <span className="eyebrow-dot" />
                    ACCESS CONTROL
                  </div>

                  <h1>Sharing permissions</h1>
                  <p>
                    Manage access to documents you own and review existing
                    permissions.
                  </p>
                </div>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setError("");
                    setActiveView("Sharing");
                    // Re-entering the view is not needed to reload;
                    // the explicit reload below handles refresh.
                    setLoadingUsers(true);
                    getUsers()
                      .then((result) => {
                        if (!Array.isArray(result)) {
                          throw new Error(
                            "The users API returned an unexpected response."
                          );
                        }
                        setUsers(result);
                      })
                      .catch((err) => {
                        setUsers([]);
                        setError(
                          err.message || "Could not load users."
                        );
                      })
                      .finally(() => setLoadingUsers(false));
                  }}
                  disabled={loadingUsers}
                >
                  {loadingUsers ? "Loading users..." : "↻ Refresh users"}
                </button>
              </section>

              <section className="panel sharing-panel">
                <div className="panel-heading">
                  <div className="heading-icon">⇄</div>
                  <div>
                    <h2>Share a document</h2>
                    <p>
                      Select a document, a user, and the access level.
                    </p>
                  </div>
                </div>

                {manageableDocuments.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">▤</div>
                    <h3>No documents to share</h3>
                    <p>
                      Upload a document before managing its permissions.
                    </p>
                  </div>
                ) : (
                  <form className="sharing-form" onSubmit={handleShare}>
                    <label className="category-field">
                      <span>Document</span>
                      <select
                        value={selectedDocumentId}
                        onChange={(event) => {
                          setSelectedDocumentId(event.target.value);
                          setMessage("");
                          setError("");
                        }}
                        required
                      >
                        <option value="">Select a document</option>
                        {manageableDocuments.map((document) => (
                          <option key={document.id} value={document.id}>
                            {document.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="category-field">
                      <span>Share with</span>
                      <select
                        value={selectedUserId}
                        onChange={(event) =>
                          setSelectedUserId(event.target.value)
                        }
                        required
                        disabled={loadingUsers || availableUsers.length === 0}
                      >
                        <option value="">
                          {loadingUsers
                            ? "Loading users..."
                            : availableUsers.length === 0
                              ? "No other users available"
                              : "Select a user"}
                        </option>

                        {availableUsers.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name || "Unnamed user"}
                            {item.email ? ` (${item.email})` : ""}
                          </option>
                        ))}
                      </select>

                      {!loadingUsers && availableUsers.length === 0 && (
                        <small>
                          No other users were returned by the users API.
                          Use Refresh users to try again.
                        </small>
                      )}
                    </label>

                    <label className="category-field">
                      <span>Permission</span>
                      <select
                        value={permission}
                        onChange={(event) =>
                          setPermission(event.target.value)
                        }
                      >
                        <option value="read">
                          Read — view and download
                        </option>
                        <option value="edit">
                          Edit — modify permitted documents
                        </option>
                      </select>
                    </label>

                    <button
                      className="primary-button upload-submit"
                      type="submit"
                      disabled={
                        savingGrant ||
                        loadingUsers ||
                        !selectedDocumentId ||
                        !selectedUserId ||
                        !availableUsers.some(
                          (item) =>
                            String(item.id) === String(selectedUserId)
                        )
                      }
                    >
                      {savingGrant ? "Saving..." : "＋ Grant access"}
                    </button>
                  </form>
                )}
              </section>

              <section className="panel documents-panel">
                <div className="section-heading">
                  <div>
                    <h2>People with access</h2>
                    <p>
                      {selectedDocumentId
                        ? "Review and manage permissions for the selected document."
                        : "Select a document above to see its current permissions."}
                    </p>
                  </div>

                  {selectedDocumentId && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => loadGrants(selectedDocumentId)}
                      disabled={loadingGrants}
                    >
                      ↻ Refresh
                    </button>
                  )}
                </div>

                {!selectedDocumentId ? (
                  <div className="empty-state">
                    <div className="empty-icon">⇄</div>
                    <h3>Select a document</h3>
                    <p>
                      Its existing sharing permissions will appear here.
                    </p>
                  </div>
                ) : loadingGrants ? (
                  <div className="empty-state">
                    <p>Loading permissions...</p>
                  </div>
                ) : safeGrants.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">♙</div>
                    <h3>No shared users yet</h3>
                    <p>Grant access using the form above.</p>
                  </div>
                ) : (
                  <div className="grant-list">
                    {safeGrants.map((grant, index) => {
                      const grantUserId =
                        grant.userId ?? grant.user_id;
                      const grantName =
                        grant.name || grant.email || "User";
                      const grantPermission =
                        grant.permission || "read";
                      const grantCreatedAt =
                        grant.createdAt ?? grant.created_at;

                      return (
                        <article
                          className="document-row grant-row"
                          key={grantUserId ?? index}
                        >
                          <div className="avatar grant-avatar">
                            {grantName.charAt(0).toUpperCase()}
                          </div>

                          <div className="document-info grant-info">
                            <h3>{grantName}</h3>
                            <p>{grant.email}</p>
                            <small>
                              Granted{" "}
                              {grantCreatedAt
                                ? new Date(
                                    grantCreatedAt
                                  ).toLocaleDateString()
                                : "previously"}
                            </small>
                          </div>

                          <div className="grant-controls">
                            <label className="grant-permission">
                              <span className="sr-only">
                                Permission for {grantName}
                              </span>
                              <select
                                value={grantPermission}
                                disabled={
                                  changingGrantUserId ===
                                    String(grantUserId) ||
                                  revokingUserId === String(grantUserId)
                                }
                                onChange={(event) =>
                                  handlePermissionChange(
                                    grant,
                                    event.target.value
                                  )
                                }
                              >
                                <option value="read">Read</option>
                                <option value="edit">Edit</option>
                              </select>
                            </label>

                            <button
                              type="button"
                              className="icon-button delete-icon"
                              title={`Revoke ${grantName}'s access`}
                              aria-label={`Revoke access for ${grantName}`}
                              disabled={
                                revokingUserId === String(grantUserId) ||
                                changingGrantUserId === String(grantUserId)
                              }
                              onClick={() => handleRevoke(grant)}
                            >
                              {revokingUserId === String(grantUserId)
                                ? "…"
                                : "×"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}

          {activeView === "Activity" && (
            <section className="audit-view">
              <section className="view-heading">
                <div>
                  <div className="eyebrow">
                    <span className="eyebrow-dot" />
                    SECURITY MONITORING
                  </div>

                  <h1>Audit activity</h1>
                  <p>
                    Review security-related actions recorded by TrustVault.
                  </p>
                </div>

                {isAdmin && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={loadAuditLogs}
                    disabled={loadingAudit}
                  >
                    {loadingAudit ? "Loading..." : "↻ Refresh logs"}
                  </button>
                )}
              </section>

              {!isAdmin ? (
                <section className="panel audit-panel">
                  <div className="empty-state">
                    <h3>Administrator access required</h3>
                    <p>
                      Audit logs are available to administrators only.
                    </p>
                  </div>
                </section>
              ) : auditError ? (
                <section className="panel audit-panel">
                  <div className="empty-state">
                    <h3>Unable to load audit logs</h3>
                    <p className="error-message">{auditError}</p>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={loadAuditLogs}
                      disabled={loadingAudit}
                    >
                      Try again
                    </button>
                  </div>
                </section>
              ) : loadingAudit && safeAuditLogs.length === 0 ? (
                <section className="panel audit-panel">
                  <div className="empty-state">
                    <p>Loading audit records...</p>
                  </div>
                </section>
              ) : safeAuditLogs.length === 0 ? (
                <section className="panel audit-panel">
                  <div className="empty-state">
                    <div className="empty-icon">◷</div>
                    <h3>No audit events found</h3>
                    <p>
                      No audit records were returned. Refresh to check again.
                    </p>
                  </div>
                </section>
              ) : (
                <section className="panel audit-panel">
                  <div className="section-heading">
                    <div>
                      <h2>Recorded events</h2>
                      <p>
                        {safeAuditLogs.length} events returned
                      </p>
                    </div>
                  </div>

                  <div className="audit-list">
                    {safeAuditLogs.map((log, index) => {
                      const action = log.action || "Activity";
                      const actor =
                        log.actorName ||
                        log.actorEmail ||
                        log.actorId ||
                        log.actor_id ||
                        "Unknown user";
                      const target =
                        log.documentName ||
                        log.documentId ||
                        log.document_id ||
                        "—";
                      const rawTimestamp =
                        log.createdAt ?? log.created_at;
                      const timestamp = rawTimestamp
                        ? new Date(rawTimestamp)
                        : null;
                      const validDate =
                        timestamp &&
                        !Number.isNaN(timestamp.getTime());

                      let details =
                        log.details ?? log.details_json;

                      if (typeof details === "string") {
                        try {
                          details = JSON.parse(details);
                        } catch {
                          details = null;
                        }
                      }

                      return (
                        <article
                          className="document-row audit-row"
                          key={log.id ?? index}
                        >
                          <div className="stat-icon purple audit-event-icon">
                            ◷
                          </div>

                          <div className="document-info audit-event-info">
                            <h3>
                              {String(action).replace(/[_-]/g, " ")}
                            </h3>
                            <p>
                              <strong>Actor:</strong> {actor}
                            </p>
                            <p>
                              <strong>Document:</strong> {target}
                            </p>

                            <span
                              className={`audit-outcome outcome-${String(
                                log.outcome || "unknown"
                              ).toLowerCase()}`}
                            >
                              {log.outcome || "unknown"}
                            </span>

                            {details &&
                              typeof details === "object" &&
                              Object.keys(details).length > 0 && (
                                <p className="audit-details">
                                  <strong>Details:</strong>{" "}
                                  {JSON.stringify(details)}
                                </p>
                              )}

                            {(log.eventHash || log.event_hash) && (
                              <p className="audit-hash">
                                <strong>Event hash:</strong>{" "}
                                {log.eventHash || log.event_hash}
                              </p>
                            )}
                          </div>

                          <div className="audit-timestamp">
                            {validDate
                              ? timestamp.toLocaleString()
                              : "Time unavailable"}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
            </section>
          )}
        </div>

        <footer className="app-footer">
          <span>© {new Date().getFullYear()} TrustVault</span>
          <span>
            <span className="footer-dot" /> Secure document workspace
          </span>
        </footer>
      </section>
    </main>
  );
}

function DocumentList({
  documents,
  user,
  onDownload,
  onRename,
  onDelete,
}) {
  const safeDocuments = Array.isArray(documents) ? documents : [];

  if (safeDocuments.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">▤</div>
        <h3>No documents found</h3>
        <p>Upload a file or try a different search.</p>
      </div>
    );
  }

  return (
    <div className="document-list">
      {safeDocuments.map((document) => {
        const canManage =
          String(user?.role || "").toLowerCase() === "owner" ||
          String(user?.role || "").toLowerCase() === "admin" ||
          String(document.owner_id ?? document.ownerId) ===
            String(user?.id);

        const extension =
          document.name?.split(".").pop()?.toUpperCase() || "FILE";

        return (
          <article className="document-row" key={document.id}>
            <div className={`file-icon ${extension === "PDF" ? "pdf" : ""}`}>
              {extension.length <= 4 ? extension : "FILE"}
            </div>

            <div className="document-info">
              <h3>{document.name || "Untitled document"}</h3>
              <p>
                <span className="category-chip">
                  {document.category || "General"}
                </span>
                <span className="document-dot">·</span>
                {document.size != null
                  ? `${(Number(document.size) / 1024).toFixed(1)} KB`
                  : "Size unavailable"}
              </p>
            </div>

            <div className="document-actions">
              <button
                type="button"
                className="download-button"
                onClick={() => onDownload(document)}
              >
                ↓ <span>Download</span>
              </button>

              {canManage && (
                <>
                  <button
                    type="button"
                    className="icon-button"
                    title="Rename document"
                    aria-label={`Rename ${document.name || "document"}`}
                    onClick={() => onRename(document)}
                  >
                    ✎
                  </button>

                  <button
                    type="button"
                    className="icon-button delete-icon"
                    title="Delete document"
                    aria-label={`Delete ${document.name || "document"}`}
                    onClick={() => onDelete(document)}
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default App;


