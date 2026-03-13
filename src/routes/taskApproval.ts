import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import { TaskType, TaskStatus, TaskApprovalStatus } from "@prisma/client";
import { enqueueApprovedTask } from "../queues/approvedTasksQueue.ts";

interface ApproveTaskParams {
  taskId: string;
}

interface ApproveTaskBody {
  approvedByUserId: string;
}

interface RejectTaskParams {
  taskId: string;
}

/**
 * Approve a task that requires approval
 */
async function approveTaskHandler(
  request: FastifyRequest<{
    Params: ApproveTaskParams;
    Body: ApproveTaskBody;
  }>,
  reply: FastifyReply
) {
  const { taskId } = request.params;
  const { approvedByUserId } = request.body;
  const logger = request.log;

  // Find task
  const task = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    return reply.status(404).send({ error: "Task not found" });
  }

  // Validate task type
  if (task.type !== TaskType.APPROVAL_REQUIRED) {
    return reply.status(400).send({
      error: "Task does not require approval",
      taskType: task.type,
    });
  }

  // Validate approval status
  if (task.approvalStatus !== TaskApprovalStatus.PENDING) {
    return reply.status(400).send({
      error: "Task is not pending approval",
      approvalStatus: task.approvalStatus,
    });
  }

  // Update task
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      approvalStatus: TaskApprovalStatus.APPROVED,
      status: TaskStatus.OPEN,
      approvedByUserId,
      approvedAt: new Date(),
    },
  });

  // Only enqueue if approvalStatus successfully transitions to APPROVED
  if (updated.approvalStatus === TaskApprovalStatus.APPROVED) {
    try {
      await enqueueApprovedTask(taskId);
      logger.info(
        { taskId, approvedByUserId, previousStatus: task.status },
        "Task approved and enqueued for processing"
      );
    } catch (error) {
      // Log error but don't fail the approval - task is already approved
      logger.error(
        { error, taskId, approvedByUserId },
        "Task approved but failed to enqueue for processing"
      );
    }
  } else {
    logger.warn(
      { taskId, approvalStatus: updated.approvalStatus },
      "Task updated but approvalStatus is not APPROVED; skipping enqueue"
    );
  }

  return reply.status(200).send(updated);
}

/**
 * Reject a task that requires approval
 */
async function rejectTaskHandler(
  request: FastifyRequest<{
    Params: RejectTaskParams;
  }>,
  reply: FastifyReply
) {
  const { taskId } = request.params;
  const logger = request.log;

  // Find task
  const task = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    return reply.status(404).send({ error: "Task not found" });
  }

  // Validate task type
  if (task.type !== TaskType.APPROVAL_REQUIRED) {
    return reply.status(400).send({
      error: "Task does not require approval",
      taskType: task.type,
    });
  }

  // Validate approval status
  if (task.approvalStatus !== TaskApprovalStatus.PENDING) {
    return reply.status(400).send({
      error: "Task is not pending approval",
      approvalStatus: task.approvalStatus,
    });
  }

  // Update task
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      approvalStatus: TaskApprovalStatus.REJECTED,
      status: TaskStatus.DONE,
    },
  });

  logger.info({ taskId, previousStatus: task.status }, "Task rejected");

  return reply.status(200).send(updated);
}

/**
 * Register task approval routes
 */
export async function taskApprovalRoutes(fastify: FastifyInstance) {
  fastify.post("/:taskId/approve", approveTaskHandler);
  fastify.post("/:taskId/reject", rejectTaskHandler);
}

