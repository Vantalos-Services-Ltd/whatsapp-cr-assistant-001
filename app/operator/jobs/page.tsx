"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getJobs, createJob, type JobListItem, type CreateJobRequest } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus, X } from "lucide-react";

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "ACTIVE":
      return "default";
    case "URGENT":
      return "destructive";
    case "PAUSED":
      return "secondary";
    case "FILLED":
      return "outline";
    case "CLOSED":
      return "outline";
    default:
      return "default";
  }
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString();
}

export default function JobsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [formErrors, setFormErrors] = useState<{ title?: string; tradeRequired?: string }>({});
  const [formData, setFormData] = useState<CreateJobRequest>({
    title: "",
    tradeRequired: "",
    positionsOpen: 1,
  });

  useEffect(() => {
    async function loadJobs() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await getJobs({ 
          q: searchQuery || undefined,
          status: statusFilter || undefined,
        });
        setJobs(data.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load jobs");
      } finally {
        setIsLoading(false);
      }
    }

    loadJobs();
  }, [searchQuery, statusFilter]);

  const handleSearch = () => {
    if (query.trim().length > 0) {
      setSearchQuery(query.trim());
    } else {
      setSearchQuery("");
    }
  };

  const handleClearSearch = () => {
    setQuery("");
    setSearchQuery("");
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const handleJobClick = (jobId: string) => {
    router.push(`/operator/jobs/${jobId}`);
  };

  const validateForm = (): boolean => {
    const errors: { title?: string; tradeRequired?: string } = {};
    
    if (!formData.title.trim()) {
      errors.title = "Title is required";
    }
    
    if (!formData.tradeRequired.trim()) {
      errors.tradeRequired = "Trade is required";
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateJob = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setIsCreating(true);
      const result = await createJob(formData);
      // Close modal and reset form
      setShowCreateModal(false);
      setFormData({ title: "", tradeRequired: "", positionsOpen: 1 });
      setFormErrors({});
      // Reload jobs list
      const data = await getJobs({ q: searchQuery || undefined });
      setJobs(data.items);
      // Navigate to the new job
      router.push(`/operator/jobs/${result.id}`);
    } catch (err) {
      // Handle API errors
      const errorMessage = err instanceof Error ? err.message : "Failed to create job";
      if (errorMessage.includes("title")) {
        setFormErrors({ title: errorMessage });
      } else if (errorMessage.includes("trade")) {
        setFormErrors({ tradeRequired: errorMessage });
      } else {
        setFormErrors({ title: errorMessage });
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setFormData({ title: "", tradeRequired: "", positionsOpen: 1 });
    setFormErrors({});
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Jobs</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage active roles and placements</p>
          </div>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Positions</TableHead>
                <TableHead>Trade</TableHead>
                <TableHead>Start Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[1, 2, 3, 4, 5].map((i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-48" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Jobs</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage active roles and placements</p>
          </div>
        </div>
        <div className="rounded-md border border-destructive bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Jobs</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage active roles and placements</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search jobs by title, trade, location, client..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyPress}
              className="pl-9 pr-9 w-80"
            />
            {query && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="URGENT">Urgent</option>
            <option value="PAUSED">Paused</option>
            <option value="FILLED">Filled</option>
            <option value="CLOSED">Closed</option>
          </select>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Job
          </Button>
        </div>
      </div>

      {/* Jobs Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Positions</TableHead>
              <TableHead>Trade</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>Location</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  {searchQuery ? "No jobs found matching your search" : "No jobs found"}
                </TableCell>
              </TableRow>
            ) : (
              jobs.map((job) => (
                <TableRow
                  key={job.id}
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => handleJobClick(job.id)}
                >
                  <TableCell className="font-medium">{job.title}</TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(job.status)}>
                      {job.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {job.positionsFilled} / {job.positionsOpen}
                  </TableCell>
                  <TableCell>{job.tradeRequired}</TableCell>
                  <TableCell>{formatDate(job.startDate)}</TableCell>
                  <TableCell>
                    {job.city || job.postcode || "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create Job Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleCloseModal}>
          <div className="bg-background border rounded-lg p-6 max-w-md w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 text-foreground">Create New Job</h3>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">
                  Title <span className="text-destructive">*</span>
                </label>
                <Input
                  type="text"
                  value={formData.title}
                  onChange={(e) => {
                    setFormData({ ...formData, title: e.target.value });
                    if (formErrors.title) setFormErrors({ ...formErrors, title: undefined });
                  }}
                  placeholder="e.g., Maidstone Residential Development"
                  className={formErrors.title ? "border-destructive" : ""}
                />
                {formErrors.title && (
                  <p className="text-sm text-destructive mt-1">{formErrors.title}</p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">
                  Trade <span className="text-destructive">*</span>
                </label>
                <Input
                  type="text"
                  value={formData.tradeRequired}
                  onChange={(e) => {
                    setFormData({ ...formData, tradeRequired: e.target.value });
                    if (formErrors.tradeRequired) setFormErrors({ ...formErrors, tradeRequired: undefined });
                  }}
                  placeholder="e.g., Labourer, Electrician"
                  className={formErrors.tradeRequired ? "border-destructive" : ""}
                />
                {formErrors.tradeRequired && (
                  <p className="text-sm text-destructive mt-1">{formErrors.tradeRequired}</p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">
                  Start Date
                </label>
                <Input
                  type="date"
                  value={formData.startDate || ""}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value || undefined })}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">
                  City
                </label>
                <Input
                  type="text"
                  value={formData.city || ""}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value || undefined })}
                  placeholder="e.g., Maidstone"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">
                  Postcode
                </label>
                <Input
                  type="text"
                  value={formData.postcode || ""}
                  onChange={(e) => setFormData({ ...formData, postcode: e.target.value || undefined })}
                  placeholder="e.g., ME14 1XX"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">
                  Positions Open
                </label>
                <Input
                  type="number"
                  min="1"
                  value={formData.positionsOpen || ""}
                  onChange={(e) => setFormData({ ...formData, positionsOpen: e.target.value ? parseInt(e.target.value) : 1 })}
                  placeholder="Default: 1"
                />
              </div>
            </div>

            <div className="flex gap-3 justify-end mt-6">
              <Button
                variant="outline"
                onClick={handleCloseModal}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={handleCreateJob}
                disabled={isCreating}
              >
                {isCreating ? "Creating..." : "Create Job"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

