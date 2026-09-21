// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 jr200-web contributors
#include "jr200/debugger.hpp"

namespace jr200 {

void DebugInstructionBuffer::clear() noexcept
{
    head_ = 0U;
    size_ = 0U;
    dropped_ = 0U;
}

void DebugInstructionBuffer::push(
    const DebugInstructionEntry& entry) noexcept
{
    if (size_ == kCapacity) {
        head_ = (head_ + 1U) % kCapacity;
        --size_;
        ++dropped_;
    }
    const size_t tail = (head_ + size_) % kCapacity;
    entries_[tail] = entry;
    ++size_;
}

size_t DebugInstructionBuffer::size() const noexcept
{
    return size_;
}

uint64_t DebugInstructionBuffer::dropped() const noexcept
{
    return dropped_;
}

DebugInstructionEntry DebugInstructionBuffer::at(size_t index) const noexcept
{
    if (index >= size_) {
        return {};
    }
    return entries_[(head_ + index) % kCapacity];
}

void DebugMemoryBuffer::clear() noexcept
{
    head_ = 0U;
    size_ = 0U;
    dropped_ = 0U;
}

void DebugMemoryBuffer::push(const DebugMemoryEntry& entry) noexcept
{
    if (size_ == kCapacity) {
        head_ = (head_ + 1U) % kCapacity;
        --size_;
        ++dropped_;
    }
    const size_t tail = (head_ + size_) % kCapacity;
    entries_[tail] = entry;
    ++size_;
}

size_t DebugMemoryBuffer::size() const noexcept
{
    return size_;
}

uint64_t DebugMemoryBuffer::dropped() const noexcept
{
    return dropped_;
}

DebugMemoryEntry DebugMemoryBuffer::at(size_t index) const noexcept
{
    if (index >= size_) {
        return {};
    }
    return entries_[(head_ + index) % kCapacity];
}

void MachineDebugger::clear_all() noexcept
{
    history_enabled_ = false;
    clear_breakpoints();
    clear_watchpoints();
    reset_runtime();
}

void MachineDebugger::reset_runtime() noexcept
{
    clear_history();
    stop_ = {};
    skip_breakpoint_once_ = false;
    skipped_breakpoint_ = 0U;
}

void MachineDebugger::clear_history() noexcept
{
    instructions_.clear();
    memory_accesses_.clear();
    instruction_sequence_ = 0U;
    memory_sequence_ = 0U;
}

void MachineDebugger::set_history_enabled(bool enabled) noexcept
{
    history_enabled_ = enabled;
}

bool MachineDebugger::history_enabled() const noexcept
{
    return history_enabled_;
}

bool MachineDebugger::add_breakpoint(uint16_t address) noexcept
{
    if (has_breakpoint(address)) {
        return true;
    }
    if (breakpoint_count_ == kBreakpointCapacity) {
        return false;
    }
    breakpoints_[breakpoint_count_] = address;
    ++breakpoint_count_;
    return true;
}

bool MachineDebugger::remove_breakpoint(uint16_t address) noexcept
{
    for (size_t i = 0U; i < breakpoint_count_; ++i) {
        if (breakpoints_[i] != address) {
            continue;
        }
        for (size_t j = i + 1U; j < breakpoint_count_; ++j) {
            breakpoints_[j - 1U] = breakpoints_[j];
        }
        --breakpoint_count_;
        return true;
    }
    return false;
}

void MachineDebugger::clear_breakpoints() noexcept
{
    breakpoint_count_ = 0U;
}

size_t MachineDebugger::breakpoint_count() const noexcept
{
    return breakpoint_count_;
}

uint16_t MachineDebugger::breakpoint_at(size_t index) const noexcept
{
    return index < breakpoint_count_ ? breakpoints_[index] : 0U;
}

bool MachineDebugger::add_watchpoint(
    uint16_t address,
    uint8_t flags) noexcept
{
    flags = static_cast<uint8_t>(
        flags & static_cast<uint8_t>(kDebugWatchRead | kDebugWatchWrite));
    if (flags == 0U) {
        return false;
    }
    for (size_t i = 0U; i < watchpoint_count_; ++i) {
        if (watchpoints_[i].address == address) {
            watchpoints_[i].flags = flags;
            return true;
        }
    }
    if (watchpoint_count_ == kWatchpointCapacity) {
        return false;
    }
    watchpoints_[watchpoint_count_] = {address, flags};
    ++watchpoint_count_;
    return true;
}

bool MachineDebugger::remove_watchpoint(uint16_t address) noexcept
{
    for (size_t i = 0U; i < watchpoint_count_; ++i) {
        if (watchpoints_[i].address != address) {
            continue;
        }
        for (size_t j = i + 1U; j < watchpoint_count_; ++j) {
            watchpoints_[j - 1U] = watchpoints_[j];
        }
        --watchpoint_count_;
        return true;
    }
    return false;
}

void MachineDebugger::clear_watchpoints() noexcept
{
    watchpoint_count_ = 0U;
}

size_t MachineDebugger::watchpoint_count() const noexcept
{
    return watchpoint_count_;
}

DebugWatchpoint MachineDebugger::watchpoint_at(size_t index) const noexcept
{
    if (index >= watchpoint_count_) {
        return {};
    }
    return watchpoints_[index];
}

bool MachineDebugger::check_breakpoint(
    uint16_t address,
    uint64_t cycle) noexcept
{
    if (skip_breakpoint_once_) {
        const bool skipped = address == skipped_breakpoint_;
        skip_breakpoint_once_ = false;
        if (skipped) {
            return false;
        }
    }
    if (!has_breakpoint(address)) {
        return false;
    }
    stop_ = {
        DebugStopReason::Breakpoint,
        address,
        0U,
        M6800BusAccess::Opcode,
        DebugMemoryOperation::Read,
        cycle,
    };
    return true;
}

void MachineDebugger::observe_memory(
    uint64_t cycle,
    uint16_t address,
    uint8_t value,
    M6800BusAccess access,
    DebugMemoryOperation operation) noexcept
{
    if (history_enabled_) {
        memory_accesses_.push({
            memory_sequence_,
            cycle,
            address,
            value,
            access,
            operation,
        });
        ++memory_sequence_;
    }

    const uint8_t flags = watch_flags(address);
    const bool read_hit = operation == DebugMemoryOperation::Read &&
        (flags & kDebugWatchRead) != 0U;
    const bool write_hit = operation == DebugMemoryOperation::Write &&
        (flags & kDebugWatchWrite) != 0U;
    if (stop_.reason != DebugStopReason::None || (!read_hit && !write_hit)) {
        return;
    }
    stop_ = {
        read_hit ? DebugStopReason::ReadWatchpoint
                 : DebugStopReason::WriteWatchpoint,
        address,
        value,
        access,
        operation,
        cycle,
    };
}

void MachineDebugger::record_instruction(
    uint64_t cycle,
    const M6800Trace& trace) noexcept
{
    if (!history_enabled_ || trace.event == M6800Event::Waiting) {
        return;
    }
    instructions_.push({instruction_sequence_, cycle, trace});
    ++instruction_sequence_;
}

void MachineDebugger::stop_after_step(
    uint16_t address,
    uint64_t cycle) noexcept
{
    if (stop_.reason == DebugStopReason::None) {
        stop_ = {
            DebugStopReason::Step,
            address,
            0U,
            M6800BusAccess::Opcode,
            DebugMemoryOperation::Read,
            cycle,
        };
    }
}

void MachineDebugger::resume() noexcept
{
    if (stop_.reason == DebugStopReason::Breakpoint) {
        skip_breakpoint_once_ = true;
        skipped_breakpoint_ = stop_.address;
    } else {
        skip_breakpoint_once_ = false;
    }
    stop_ = {};
}

void MachineDebugger::prepare_step() noexcept
{
    stop_ = {};
    skip_breakpoint_once_ = false;
}

bool MachineDebugger::stopped() const noexcept
{
    return stop_.reason != DebugStopReason::None;
}

DebugStop MachineDebugger::stop() const noexcept
{
    return stop_;
}

const DebugInstructionBuffer& MachineDebugger::instructions() const noexcept
{
    return instructions_;
}

const DebugMemoryBuffer& MachineDebugger::memory_accesses() const noexcept
{
    return memory_accesses_;
}

bool MachineDebugger::has_breakpoint(uint16_t address) const noexcept
{
    for (size_t i = 0U; i < breakpoint_count_; ++i) {
        if (breakpoints_[i] == address) {
            return true;
        }
    }
    return false;
}

uint8_t MachineDebugger::watch_flags(uint16_t address) const noexcept
{
    for (size_t i = 0U; i < watchpoint_count_; ++i) {
        if (watchpoints_[i].address == address) {
            return watchpoints_[i].flags;
        }
    }
    return 0U;
}

}  // namespace jr200
