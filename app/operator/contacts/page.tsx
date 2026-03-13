"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getAllContacts, getCandidateDetail, type ContactDTO, type CandidateDetailDTO } from "@/lib/api";
import { ContactCard } from "@/components/contacts/ContactCard";
import { ContactProfileDrawer } from "@/components/contacts/ContactProfileDrawer";
import { Skeleton } from "@/components/ui/skeleton";

interface ContactWithData extends ContactDTO {
  status: "ACTIVE" | "PAUSED" | "DORMANT" | "PLACED";
}

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedContactPhone, setSelectedContactPhone] = useState<string | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [candidateDetail, setCandidateDetail] = useState<CandidateDetailDTO | null>(null);
  const [isLoadingCandidate, setIsLoadingCandidate] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);
        
        // Fetch contacts (now includes conversation and task data)
        const contactsData = await getAllContacts();
        setContacts(contactsData.contacts);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load contacts");
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  // Determine status from API data
  const contactsWithData = useMemo<ContactWithData[]>(() => {
    return contacts.map((contact) => {
      // Determine status from API data
      let status: "ACTIVE" | "PAUSED" | "DORMANT" | "PLACED" = "DORMANT";
      
      // Priority 1: Check for pending approval
      if (contact.hasPendingApproval) {
        status = "PAUSED";
      } 
      // Priority 2: Check conversation state
      else if (contact.conversationState) {
        if (contact.conversationState === "PAUSED" || contact.conversationState === "PAUSED_FOR_APPROVAL") {
          status = "PAUSED";
        } else if (contact.conversationState === "ACTIVE") {
          status = "ACTIVE";
        }
      } 
      // Priority 3: Check lastSeenAt for time-based status
      else if (contact.lastSeenAt) {
        const lastSeen = new Date(contact.lastSeenAt);
        const daysSince = (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince <= 7) {
          status = "ACTIVE";
        } else if (daysSince > 30) {
          status = "DORMANT";
        }
      }

      return {
        ...contact,
        status,
      };
    });
  }, [contacts]);

  // Group contacts into sections
  const groupedContacts = useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const recentlyActive: ContactWithData[] = [];
    const awaitingApproval: ContactWithData[] = [];
    const dormant: ContactWithData[] = [];

    contactsWithData.forEach((contact) => {
      // Awaiting Approval takes priority
      if (contact.hasPendingApproval) {
        awaitingApproval.push(contact);
        return;
      }

      // Determine time-based grouping using lastSeenAt
      if (contact.lastSeenAt) {
        const lastActivityTime = new Date(contact.lastSeenAt).getTime();
        if (lastActivityTime >= sevenDaysAgo) {
          // Recently Active: <= 7 days
          recentlyActive.push(contact);
        } else if (lastActivityTime < thirtyDaysAgo) {
          // Dormant: > 30 days
          dormant.push(contact);
        } else {
          // Between 7-30 days: put in Recently Active as fallback
          recentlyActive.push(contact);
        }
      } else {
        // No activity data: put in Dormant
        dormant.push(contact);
      }
    });

    // Sort Recently Active: most recent first
    recentlyActive.sort((a, b) => {
      const aTime = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
      const bTime = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
      return bTime - aTime; // Most recent first
    });

    // Sort Awaiting Approval: most recent first
    awaitingApproval.sort((a, b) => {
      const aTime = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
      const bTime = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
      return bTime - aTime; // Most recent first
    });

    // Sort Dormant: highest past activity first (most recent lastSeenAt first)
    dormant.sort((a, b) => {
      const aTime = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
      const bTime = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
      return bTime - aTime; // Most recent first (highest past activity)
    });

    return { recentlyActive, awaitingApproval, dormant };
  }, [contactsWithData]);

  const handleOpenMessages = (candidateId: string | null, conversationId: string | null) => {
    if (conversationId) {
      router.push(`/operator/messages?conversation=${conversationId}`);
    } else {
      router.push("/operator/messages");
    }
  };

  const handleViewProfile = (candidateId: string | null, contact?: ContactWithData) => {
    setSelectedCandidateId(candidateId);
    // Store the contact phone to find the contact data for fallback
    if (contact) {
      setSelectedContactPhone(contact.phone);
    }
    setIsProfileOpen(true);
  };

  // Fetch candidate detail when drawer opens
  useEffect(() => {
    async function loadCandidateDetail() {
      if (!isProfileOpen || !selectedCandidateId) {
        setCandidateDetail(null);
        return;
      }

      try {
        setIsLoadingCandidate(true);
        const detail = await getCandidateDetail(selectedCandidateId);
        setCandidateDetail(detail);
      } catch (err) {
        console.error("Failed to load candidate detail:", err);
        // Keep existing detail or null
        setCandidateDetail(null);
      } finally {
        setIsLoadingCandidate(false);
      }
    }

    loadCandidateDetail();
  }, [isProfileOpen, selectedCandidateId]);

  // Find the contact data for the selected candidate (for fallback)
  const selectedContact = useMemo(() => {
    if (!isProfileOpen) return null;
    
    // If we have candidate detail, match contact by phone
    if (candidateDetail) {
      return contacts.find((c) => c.phone === candidateDetail.phone) || null;
    }
    
    // If we have selectedContactPhone, find the contact by phone
    if (selectedContactPhone) {
      return contacts.find((c) => c.phone === selectedContactPhone) || null;
    }
    
    return null;
  }, [isProfileOpen, contacts, candidateDetail, selectedContactPhone]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Contacts</h2>
        <p className="text-muted-foreground mt-1">
          Manage your contacts and candidates
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-lg border bg-card p-4">
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-destructive">
          {error}
        </div>
      ) : contactsWithData.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          No contacts found
        </div>
      ) : (
        <div className="space-y-8">
          {/* Recently Active Section */}
          {groupedContacts.recentlyActive.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">
                  Recently Active
                </h3>
                <span className="text-sm text-muted-foreground">
                  {groupedContacts.recentlyActive.length}
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {groupedContacts.recentlyActive.map((contact) => (
                  <ContactCard
                    key={contact.id}
                    candidate={{
                      name: contact.candidateName || contact.name,
                      phone: contact.phone,
                      desiredRole: contact.desiredRole || undefined,
                    }}
                    candidateId={null} // TODO: Add candidateId to ContactDTO
                    lastConversation={contact.lastConversationId ? {
                      conversationId: contact.lastConversationId,
                      participantPhone: contact.phone,
                      participantDisplayName: contact.candidateName || contact.name || contact.phone,
                      updatedAt: contact.lastSeenAt || new Date().toISOString(),
                      state: (contact.conversationState as any) || "ACTIVE",
                      pausedReason: null,
                      lastMessageSnippet: contact.lastMessageSnippet || null,
                    } : undefined}
                    lastMessageSnippet={contact.lastMessageSnippet || undefined}
                    status={contact.status}
                    onOpenMessages={handleOpenMessages}
                    onViewProfile={(candidateId) => handleViewProfile(candidateId, contact)}
                    progressStage={contact.progressStage}
                    memorySummary={contact.memorySummary || undefined}
                    followUpAt={contact.followUpAt || undefined}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Awaiting Approval Section */}
          {groupedContacts.awaitingApproval.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">
                  Awaiting Approval
                </h3>
                <span className="text-sm text-muted-foreground">
                  {groupedContacts.awaitingApproval.length}
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {groupedContacts.awaitingApproval.map((contact) => (
                  <ContactCard
                    key={contact.id}
                    candidate={{
                      name: contact.candidateName || contact.name,
                      phone: contact.phone,
                      desiredRole: contact.desiredRole || undefined,
                    }}
                    candidateId={null} // TODO: Add candidateId to ContactDTO
                    lastConversation={contact.lastConversationId ? {
                      conversationId: contact.lastConversationId,
                      participantPhone: contact.phone,
                      participantDisplayName: contact.candidateName || contact.name || contact.phone,
                      updatedAt: contact.lastSeenAt || new Date().toISOString(),
                      state: (contact.conversationState as any) || "ACTIVE",
                      pausedReason: null,
                      lastMessageSnippet: contact.lastMessageSnippet || null,
                    } : undefined}
                    lastMessageSnippet={contact.lastMessageSnippet || undefined}
                    status={contact.status}
                    onOpenMessages={handleOpenMessages}
                    onViewProfile={(candidateId) => handleViewProfile(candidateId, contact)}
                    progressStage={contact.progressStage}
                    memorySummary={contact.memorySummary || undefined}
                    followUpAt={contact.followUpAt || undefined}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Dormant Section */}
          {groupedContacts.dormant.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">
                  Dormant
                </h3>
                <span className="text-sm text-muted-foreground">
                  {groupedContacts.dormant.length}
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {groupedContacts.dormant.map((contact) => (
                  <ContactCard
                    key={contact.id}
                    candidate={{
                      name: contact.candidateName || contact.name,
                      phone: contact.phone,
                      desiredRole: contact.desiredRole || undefined,
                    }}
                    candidateId={null} // TODO: Add candidateId to ContactDTO
                    lastConversation={contact.lastConversationId ? {
                      conversationId: contact.lastConversationId,
                      participantPhone: contact.phone,
                      participantDisplayName: contact.candidateName || contact.name || contact.phone,
                      updatedAt: contact.lastSeenAt || new Date().toISOString(),
                      state: (contact.conversationState as any) || "ACTIVE",
                      pausedReason: null,
                      lastMessageSnippet: contact.lastMessageSnippet || null,
                    } : undefined}
                    lastMessageSnippet={contact.lastMessageSnippet || undefined}
                    status={contact.status}
                    onOpenMessages={handleOpenMessages}
                    onViewProfile={(candidateId) => handleViewProfile(candidateId, contact)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Contact Profile Drawer */}
      <ContactProfileDrawer
        isOpen={isProfileOpen}
        onClose={() => {
          setIsProfileOpen(false);
          setSelectedCandidateId(null);
          setSelectedContactPhone(null);
          setCandidateDetail(null);
        }}
        candidate={
          candidateDetail
            ? {
                name: candidateDetail.name,
                phone: candidateDetail.phone,
                desiredRole: candidateDetail.desiredRole || undefined,
                location: candidateDetail.location || undefined,
                skills: candidateDetail.skills || undefined,
                yearsExperience: candidateDetail.yearsExperience || undefined,
                salaryMin: candidateDetail.salary?.min || undefined,
                salaryMax: candidateDetail.salary?.max || undefined,
                currency: candidateDetail.salary?.currency || undefined,
                availabilityNotes: candidateDetail.availabilityNotes || undefined,
              }
            : selectedContact
            ? {
                name: selectedContact.candidateName || selectedContact.name,
                phone: selectedContact.phone,
                desiredRole: selectedContact.desiredRole || undefined,
              }
            : null
        }
        candidateId={selectedCandidateId}
        status={
          selectedContact?.status ||
          (candidateDetail ? "ACTIVE" : "DORMANT")
        }
        lastSeenAt={candidateDetail?.lastSeenAt || selectedContact?.lastSeenAt || null}
        lastMessageSnippet={selectedContact?.lastMessageSnippet || null}
        onOpenMessages={handleOpenMessages}
        onViewCandidate={(id) => {
          if (id) {
            router.push(`/operator/candidates/${id}`);
          }
        }}
      />
    </div>
  );
}
