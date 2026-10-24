const API_BASE =
  (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "") + "/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));

    throw new Error(
      data.error ||
        data.message ||
        `Request failed (${response.status})`
    );
  }

  if (response.status === 204) {
    return null;
  }

  return response;
}

// Fetch documents
export async function getDocuments() {
  const response = await request("/documents");
  const data = await response.json();

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.documents)) {
    return data.documents;
  }

  throw new Error(
    "The documents API returned an unexpected response."
  );
}

// Fetch users for document sharing
export async function getUsers() {
  const response = await request("/users");
  const data = await response.json();

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.users)) {
    return data.users;
  }

  throw new Error(
    "The users API returned an unexpected response."
  );
}

// Fetch audit logs
export async function getAuditLogs() {
  const response = await request("/audit");
  const data = await response.json();

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.logs)) {
    return data.logs;
  }

  throw new Error(
    "The audit API returned an unexpected response."
  );
}

// Upload a document
export async function uploadDocument(file, category = "General") {
  const formData = new FormData();

  formData.append("file", file);
  formData.append("category", category);
  formData.append("name", file.name);

  const response = await request("/documents", {
    method: "POST",
    body: formData,
  });

  return response.json();
}

// Download a document
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
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }
}

// Rename a document
export async function renameDocument(documentId, name) {
  const response = await request(
    `/documents/${encodeURIComponent(documentId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }
  );

  return response.json();
}

// Delete a document
export async function deleteDocument(documentId) {
  return request(
    `/documents/${encodeURIComponent(documentId)}`,
    {
      method: "DELETE",
    }
  );
}

// Fetch permissions granted for a document
export async function getDocumentGrants(documentId) {
  const response = await request(
    `/documents/${encodeURIComponent(documentId)}/grants`
  );

  const data = await response.json();

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.grants)) {
    return data.grants;
  }

  throw new Error(
    "The document permissions API returned an unexpected response."
  );
}

// Grant document access to a user
export async function grantDocumentAccess(
  documentId,
  userId,
  permission = "read"
) {
  const response = await request(
    `/documents/${encodeURIComponent(documentId)}/grants/${encodeURIComponent(userId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ permission }),
    }
  );

  return response.json();
}

// Revoke document access from a user
export async function revokeDocumentAccess(documentId, userId) {
  return request(
    `/documents/${encodeURIComponent(documentId)}/grants/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
    }
  );
}