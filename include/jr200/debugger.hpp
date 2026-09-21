// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 jr200-web contributors
#pragma once

#include "jr200/m6800.hpp"

#include <stddef.h>
#include <stdint.h>

namespace jr200 {

enum class DebugStopReason : uint8_t {
    None,
    Breakpoint,
    ReadWatchpoint,
    WriteWatchpoint,
    Step,
};

enum class DebugMemoryOperation : uint8_t {
    Read,
    Write,
};

constexpr uint8_t kDebugWatchRead = 0x01U;
constexpr uint8_t kDebugWatchWrite = 0x02U;

struct DebugInstructionEntry {
    uint64_t sequence{};
    uint64_t cycle{};
    M6800Trace trace{};
};

struct DebugMemoryEntry {
    uint64_t sequence{};
    uint64_t cycle{};
    uint16_t address{};
    uint8_t value{};
    M6800BusAccess access{M6800BusAccess::Data};
    DebugMemoryOperation operation{DebugMemoryOperation::Read};
};

struct DebugWatchpoint {
    uint16_t address{};
    uint8_t flags{};
};

struct DebugStop {
    DebugStopReason reason{DebugStopReason::None};
    uint16_t address{};
    uint8_t value{};
    M6800BusAccess access{M6800BusAccess::Opcode};
    DebugMemoryOperation operation{DebugMemoryOperation::Read};
    uint64_t cycle{};
};

class DebugInstructionBuffer {
public:
    static constexpr size_t kCapacity = 256U;

    void clear() noexcept;
    void push(const DebugInstructionEntry& entry) noexcept;
    [[nodiscard]] size_t size() const noexcept;
    [[nodiscard]] uint64_t dropped() const noexcept;
    [[nodiscard]] DebugInstructionEntry at(size_t index) const noexcept;

private:
    DebugInstructionEntry entries_[kCapacity]{};
    size_t head_{};
    size_t size_{};
    uint64_t dropped_{};
};

class DebugMemoryBuffer {
public:
    static constexpr size_t kCapacity = 512U;

    void clear() noexcept;
    void push(const DebugMemoryEntry& entry) noexcept;
    [[nodiscard]] size_t size() const noexcept;
    [[nodiscard]] uint64_t dropped() const noexcept;
    [[nodiscard]] DebugMemoryEntry at(size_t index) const noexcept;

private:
    DebugMemoryEntry entries_[kCapacity]{};
    size_t head_{};
    size_t size_{};
    uint64_t dropped_{};
};

class MachineDebugger {
public:
    static constexpr size_t kBreakpointCapacity = 16U;
    static constexpr size_t kWatchpointCapacity = 16U;

    void clear_all() noexcept;
    void reset_runtime() noexcept;
    void clear_history() noexcept;

    void set_history_enabled(bool enabled) noexcept;
    [[nodiscard]] bool history_enabled() const noexcept;

    [[nodiscard]] bool add_breakpoint(uint16_t address) noexcept;
    [[nodiscard]] bool remove_breakpoint(uint16_t address) noexcept;
    void clear_breakpoints() noexcept;
    [[nodiscard]] size_t breakpoint_count() const noexcept;
    [[nodiscard]] uint16_t breakpoint_at(size_t index) const noexcept;

    [[nodiscard]] bool add_watchpoint(
        uint16_t address,
        uint8_t flags) noexcept;
    [[nodiscard]] bool remove_watchpoint(uint16_t address) noexcept;
    void clear_watchpoints() noexcept;
    [[nodiscard]] size_t watchpoint_count() const noexcept;
    [[nodiscard]] DebugWatchpoint watchpoint_at(size_t index) const noexcept;

    [[nodiscard]] bool check_breakpoint(
        uint16_t address,
        uint64_t cycle) noexcept;
    void observe_memory(
        uint64_t cycle,
        uint16_t address,
        uint8_t value,
        M6800BusAccess access,
        DebugMemoryOperation operation) noexcept;
    void record_instruction(
        uint64_t cycle,
        const M6800Trace& trace) noexcept;
    void stop_after_step(uint16_t address, uint64_t cycle) noexcept;
    void resume() noexcept;
    void prepare_step() noexcept;

    [[nodiscard]] bool stopped() const noexcept;
    [[nodiscard]] DebugStop stop() const noexcept;
    [[nodiscard]] const DebugInstructionBuffer& instructions() const noexcept;
    [[nodiscard]] const DebugMemoryBuffer& memory_accesses() const noexcept;

private:
    bool history_enabled_{};
    uint16_t breakpoints_[kBreakpointCapacity]{};
    size_t breakpoint_count_{};
    DebugWatchpoint watchpoints_[kWatchpointCapacity]{};
    size_t watchpoint_count_{};
    DebugInstructionBuffer instructions_{};
    DebugMemoryBuffer memory_accesses_{};
    uint64_t instruction_sequence_{};
    uint64_t memory_sequence_{};
    DebugStop stop_{};
    bool skip_breakpoint_once_{};
    uint16_t skipped_breakpoint_{};

    [[nodiscard]] bool has_breakpoint(uint16_t address) const noexcept;
    [[nodiscard]] uint8_t watch_flags(uint16_t address) const noexcept;
};

}  // namespace jr200
