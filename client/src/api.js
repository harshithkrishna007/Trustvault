
const API_BASE = "http://localhost:4000/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers
    }
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));

    throw new Error(
      data.error || `Request failed (${response.status})`
    );
  }

  if (response.status === 204) {
    return null;
  }

  return response;
}

// Get documents the signed-in user can access.
export async function getDocuments() {
  const response = await request("/documents");
  const data = await response.json();

  return data.documents;
}

// Get active users available for sharing.
export async function getUsers() {
  const response = await request("/users");
  const data = await response.json();

  return data.users;
}

// Get audit logs (administrator only).
export async function getAuditLogs() {
  const response = await request("/audit");
  const data = await response.json();

  return data.logs;
}

// Upload a document.
export async function uploadDocument(
  file,
  category = "General"
) {
  const formData = new FormData();

  formData.append("file", file);
  formData.append("category", category);
  formData.append("name", file.name);

  const response = await request("/documents", {
    method: "POST",
    body: formData
  });

  return response.json();
}

// Download a document.
export async function downloadDocument(documentId, name) {
  const response = await request(
    `/documents/${encodeURIComponent(documentId)}/download`
  );

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  try {
    const link = document.createElement("a");

    link.href = url;
    link.download = name || "document";

    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Rename a document.
export async function renameDocument(documentId, name) {
  const response = await request(
    `/documents/${encodeURIComponent(documentId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name })
    }
  );

  return response.json();
}

// Soft-delete a document.
export async function deleteDocument(documentId) {
  return request(
    `/documents/${encodeURIComponent(documentId)}`,
    { method: "DELETE" }
  );
}

// Get users who have access to a document.
export async function getDocumentGrants(documentId) {
  const response = await request(
    `/documents/${encodeURIComponent(documentId)}/grants`
  );

  const data = await response.json();

  return data.grants;
}

// Grant access or update an existing permission.
export async function grantDocumentAccess(
  documentId,
  userId,
  permission = "read"
) {
  const response = await request(
    `/documents/${encodeURIComponent(documentId)}/grants/${encodeURIComponent(userId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ permission })
    }
  );

  return response.json();
}

// Revoke a user's access to a document.
export async function revokeDocumentAccess(
  documentId,
  userId
) {
  const response = await request(
    `/documents/${encodeURIComponent(documentId)}/grants/${encodeURIComponent(userId)}`,
    { method: "DELETE" }
  );

  return response.json();
}
