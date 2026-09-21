// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2017,2020 FIND
// Copyright (c) 2026 jr200-web contributors
// Adapted into an OS-independent peripheral core for jr200-web.
#include "jr200/peripherals.hpp"

namespace jr200 {

namespace {

constexpr uint8_t kBorrow = 0x20U;
constexpr uint8_t kIrq = 0x40U;
constexpr uint8_t kStatusAny = 0x80U;
constexpr uint32_t kColors[8]{
    0xff000000U,
    0xff0000ffU,
    0xffff0000U,
    0xffff00ffU,
    0xff00ff00U,
    0xff00ffffU,
    0xffffff00U,
    0xffffffffU,
};

}  // namespace

void PcmQueue::clear() noexcept
{
    head_ = 0U;
    size_ = 0U;
    dropped_ = 0U;
}

void PcmQueue::push(const PcmFrame& frame) noexcept
{
    if (size_ == kCapacity) {
        head_ = (head_ + 1U) % kCapacity;
        --size_;
        ++dropped_;
    }
    const size_t tail = (head_ + size_) % kCapacity;
    frames_[tail] = frame;
    ++size_;
}

bool PcmQueue::pop(PcmFrame& frame) noexcept
{
    if (size_ == 0U) {
        return false;
    }
    frame = frames_[head_];
    head_ = (head_ + 1U) % kCapacity;
    --size_;
    return true;
}

size_t PcmQueue::size() const noexcept
{
    return size_;
}

uint64_t PcmQueue::dropped() const noexcept
{
    return dropped_;
}

void Mn1271::reset() noexcept
{
    for (size_t i = 0U; i < 32U; ++i) {
        reg_[i] = 0U;
    }
    reg17_write_buffer_ = 0U;
    reg1a_write_buffer_ = 0U;
    for (size_t i = 0U; i < 6U; ++i) {
        timer_set_[i] = 0U;
        timer_cycle_[i] = 0U;
        timer_enabled_[i] = false;
    }
    for (size_t i = 0U; i < 3U; ++i) {
        playing_[i] = false;
        frequency_[i] = 0U;
        phase_[i] = 0U;
    }
    audio_numerator_ = 0U;
    cassette_input_ = false;
    cassette_remote_ = false;
    read_activity_ = false;
    write_activity_ = false;
    cassette_head_ = 0U;
    cassette_size_ = 0U;
    cassette_dropped_ = 0U;
}

uint8_t Mn1271::read(uint8_t reg) noexcept
{
    if (reg >= 32U) {
        return 0U;
    }

    uint8_t value = reg_[reg];
    switch (reg) {
    case 0x03U:
        value = static_cast<uint8_t>(value | 0x10U);
        break;
    case 0x07U:
        read_activity_ = true;
        if (cassette_remote_) {
            reg_[reg] = static_cast<uint8_t>(
                (reg_[reg] & 0x7fU) | (cassette_input_ ? 0x80U : 0U));
            value = reg_[reg];
        }
        break;
    case 0x0aU:
        reg_[reg] = 0U;
        break;
    case 0x0cU:
        value = static_cast<uint8_t>(value | kBorrow);
        break;
    case 0x0eU:
        reg_[reg] = static_cast<uint8_t>(reg_[reg] & ~kBorrow);
        reg_[0x1dU] = static_cast<uint8_t>(reg_[0x1dU] & 0xfeU);
        refresh_irq_flag();
        break;
    case 0x10U:
        reg_[reg] = static_cast<uint8_t>(reg_[reg] & ~kBorrow);
        reg_[0x1dU] = static_cast<uint8_t>(reg_[0x1dU] & 0xfdU);
        refresh_irq_flag();
        break;
    case 0x12U:
        reg_[reg] = static_cast<uint8_t>(reg_[reg] & ~kBorrow);
        reg_[0x1dU] = static_cast<uint8_t>(reg_[0x1dU] & 0xfbU);
        refresh_irq_flag();
        break;
    case 0x14U:
        reg_[reg] = static_cast<uint8_t>(reg_[reg] & ~kBorrow);
        reg_[0x1dU] = static_cast<uint8_t>(reg_[0x1dU] & 0xf7U);
        refresh_irq_flag();
        break;
    case 0x16U:
        reg_[reg] = static_cast<uint8_t>(reg_[reg] & ~kBorrow);
        reg_[0x1dU] = static_cast<uint8_t>(reg_[0x1dU] & 0xefU);
        refresh_irq_flag();
        break;
    case 0x19U:
        reg_[reg] = static_cast<uint8_t>(reg_[reg] & ~kBorrow);
        reg_[0x1dU] = static_cast<uint8_t>(reg_[0x1dU] & 0xdfU);
        refresh_irq_flag();
        break;
    case 0x1cU:
        reg_[0x1cU] = 0U;
        refresh_irq_flag();
        break;
    default:
        break;
    }
    return value;
}

uint8_t Mn1271::peek(uint8_t reg) const noexcept
{
    if (reg >= 32U) {
        return 0U;
    }
    if (reg == 0x03U) {
        return static_cast<uint8_t>(reg_[reg] | 0x10U);
    }
    return reg_[reg];
}

void Mn1271::write(uint8_t reg, uint8_t value) noexcept
{
    if (reg >= 32U) {
        return;
    }

    switch (reg) {
    case 0x00U:
        reg_[reg] = value;
        break;
    case 0x01U:
        reg_[reg] = static_cast<uint8_t>(value & reg_[0x00U]);
        break;
    case 0x02U:
        reg_[reg] = value;
        break;
    case 0x03U:
        reg_[reg] = static_cast<uint8_t>(value & reg_[0x02U]);
        break;
    case 0x04U:
        reg_[reg] = value;
        break;
    case 0x05U:
        reg_[reg] = static_cast<uint8_t>(
            (value & reg_[0x04U]) |
            static_cast<uint8_t>(~reg_[0x04U]));
        break;
    case 0x06U:
        reg_[reg] = value;
        break;
    case 0x07U:
        reg_[reg] = static_cast<uint8_t>(value & reg_[0x06U]);
        cassette_remote_ = (value & 0x40U) != 0U;
        break;
    case 0x08U:
        reg_[reg] = static_cast<uint8_t>(value & 0x77U);
        break;
    case 0x09U:
        reg_[reg] = static_cast<uint8_t>(value & 0x77U);
        if ((value & 0x10U) != 0U) {
            assert_irq(Mn1271Irq::KeyOn);
        }
        break;
    case 0x0aU:
        reg_[reg] = static_cast<uint8_t>(value & 0x87U);
        break;
    case 0x0bU:
        reg_[reg] = static_cast<uint8_t>(value & 0x9fU);
        break;
    case 0x0cU:
        reg_[reg] = value;
        set_irq_mask_1(6U, (value & kIrq) != 0U);
        break;
    case 0x0dU:
        reg_[reg] = value;
        write_activity_ = true;
        if (cassette_remote_) {
            push_cassette_output(value);
            reg_[0x0cU] = static_cast<uint8_t>(reg_[0x0cU] | kBorrow);
        }
        break;
    case 0x0eU:
        reg_[reg] = static_cast<uint8_t>(value & 0x59U);
        reg_[0x1dU] = static_cast<uint8_t>(reg_[0x1dU] & 0xfeU);
        timer_cycle_[0] = 0U;
        timer_enabled_[0] = (value & 0x01U) != 0U;
        if (value == 0x01U) {
            reg_[0x0cU] = static_cast<uint8_t>(reg_[0x0cU] | kBorrow);
        }
        set_irq_mask_2(0U, (value & kIrq) != 0U);
        refresh_irq_flag();
        break;
    case 0x0fU:
        reg_[reg] = value;
        timer_set_[0] = value == 0U ? 0x100U : value;
        timer_cycle_[0] = 0U;
        break;
    case 0x10U:
        reg_[reg] = static_cast<uint8_t>(value & 0x59U);
        reg_[0x1dU] = static_cast<uint8_t>(reg_[0x1dU] & 0xfdU);
        timer_cycle_[1] = 0U;
        timer_enabled_[1] = (value & 0x01U) != 0U;
        set_irq_mask_2(1U, (value & kIrq) != 0U);
        refresh_irq_flag();
        break;
    case 0x11U:
        reg_[reg] = value;
        timer_set_[1] = value == 0U ? 0x100U : value;
        timer_cycle_[1] = 0U;
        break;
    case 0x12U:
        reg_[reg] = static_cast<uint8_t>(value & 0x5fU);
        reg_[0x1dU] = static_cast<uint8_t>(reg_[0x1dU] & 0xfbU);
        timer_cycle_[2] = 0U;
        timer_enabled_[2] = (value & 0x07U) != 0U;
        update_sound_control(0U);
        set_irq_mask_2(2U, (value & kIrq) != 0U);
        refresh_irq_flag();
        break;
    case 0x13U:
        reg_[reg] = value;
        timer_set_[2] = value == 0U ? 0x100U : value;
        timer_cycle_[2] = 0U;
        update_sound_frequency(0U);
        break;
    case 0x14U:
        reg_[reg] = static_cast<uint8_t>(value & 0x5fU);
        reg_[0x1dU] = static_cast<uint8_t>(reg_[0x1dU] & 0xf7U);
        timer_cycle_[3] = 0U;
        timer_enabled_[3] = (value & 0x07U) != 0U;
        update_sound_control(1U);
        set_irq_mask_2(3U, (value & kIrq) != 0U);
        refresh_irq_flag();
        break;
    case 0x15U:
        reg_[reg] = value;
        timer_set_[3] = value == 0U ? 0x100U : value;
        timer_cycle_[3] = 0U;
        update_sound_frequency(1U);
        break;
    case 0x16U:
        reg_[reg] = static_cast<uint8_t>(value & 0x5fU);
        reg_[0x1dU] = static_cast<uint8_t>(reg_[0x1dU] & 0xefU);
        timer_cycle_[4] = 0U;
        timer_enabled_[4] = (value & 0x07U) != 0U;
        set_irq_mask_2(4U, (value & kIrq) != 0U);
        refresh_irq_flag();
        break;
    case 0x17U:
        reg17_write_buffer_ = value;
        break;
    case 0x18U:
        reg_[0x17U] = reg17_write_buffer_;
        reg_[0x18U] = value;
        timer_set_[4] = static_cast<uint32_t>(
            (static_cast<uint32_t>(reg17_write_buffer_) << 8U) |
            static_cast<uint32_t>(value));
        if (timer_set_[4] == 0U) {
            timer_set_[4] = 0x10000U;
        }
        timer_cycle_[4] = 0U;
        break;
    case 0x19U:
        reg_[reg] = static_cast<uint8_t>(value & 0x5fU);
        reg_[0x1dU] = static_cast<uint8_t>(reg_[0x1dU] & 0xdfU);
        timer_cycle_[5] = 0U;
        timer_enabled_[5] = (value & 0x07U) != 0U;
        update_sound_control(2U);
        set_irq_mask_2(5U, (value & kIrq) != 0U);
        refresh_irq_flag();
        break;
    case 0x1aU:
        reg1a_write_buffer_ = value;
        break;
    case 0x1bU:
        reg_[0x1aU] = reg1a_write_buffer_;
        reg_[0x1bU] = value;
        timer_set_[5] = static_cast<uint32_t>(
            (static_cast<uint32_t>(reg1a_write_buffer_) << 8U) |
            static_cast<uint32_t>(value));
        if (timer_set_[5] == 0U) {
            timer_set_[5] = 0x10000U;
        }
        timer_cycle_[5] = 0U;
        update_sound_frequency(2U);
        break;
    case 0x1cU:
    case 0x1dU:
        break;
    case 0x1eU:
        reg_[reg] = static_cast<uint8_t>(value & 0x47U);
        write_irq_mask_1(value);
        break;
    case 0x1fU:
        reg_[reg] = static_cast<uint8_t>(value & 0x3fU);
        write_irq_mask_2(value);
        break;
    default:
        break;
    }
}

uint8_t Mn1271::io_read(uint8_t reg) const noexcept
{
    return reg < 30U ? reg_[reg] : 0U;
}

void Mn1271::io_write(uint8_t reg, uint8_t value) noexcept
{
    if (reg < 30U) {
        reg_[reg] = value;
    }
}

void Mn1271::assert_irq(Mn1271Irq source) noexcept
{
    uint8_t mask_reg = 0U;
    uint8_t mask = 0U;
    uint8_t status_reg = 0U;
    uint8_t status = 0U;

    switch (source) {
    case Mn1271Irq::KeyOn:
        mask_reg = 0x1eU; mask = 0x01U; status_reg = 0x1cU; status = 0x01U;
        break;
    case Mn1271Irq::System:
        mask_reg = 0x1eU; mask = 0x02U; status_reg = 0x1cU; status = 0x02U;
        break;
    case Mn1271Irq::User:
        mask_reg = 0x1eU; mask = 0x04U; status_reg = 0x1cU; status = 0x04U;
        break;
    case Mn1271Irq::Serial:
        mask_reg = 0x1eU; mask = 0x40U; status_reg = 0x1cU; status = 0x40U;
        break;
    case Mn1271Irq::TimerA:
        mask_reg = 0x1fU; mask = 0x01U; status_reg = 0x1dU; status = 0x01U;
        break;
    case Mn1271Irq::TimerB:
        mask_reg = 0x1fU; mask = 0x02U; status_reg = 0x1dU; status = 0x02U;
        break;
    case Mn1271Irq::TimerC:
        mask_reg = 0x1fU; mask = 0x04U; status_reg = 0x1dU; status = 0x04U;
        break;
    case Mn1271Irq::TimerD:
        mask_reg = 0x1fU; mask = 0x08U; status_reg = 0x1dU; status = 0x08U;
        break;
    case Mn1271Irq::TimerE:
        mask_reg = 0x1fU; mask = 0x10U; status_reg = 0x1dU; status = 0x10U;
        break;
    case Mn1271Irq::TimerF:
        mask_reg = 0x1fU; mask = 0x20U; status_reg = 0x1dU; status = 0x20U;
        break;
    }

    if ((reg_[mask_reg] & mask) != 0U) {
        reg_[status_reg] = static_cast<uint8_t>(reg_[status_reg] | status);
    }
    refresh_irq_flag();
}

void Mn1271::tick(uint32_t cycles, PcmQueue& pcm) noexcept
{
    tick_timer(0U, 0x0eU, 0x0fU, 0x18U, 0x01U,
               Mn1271Irq::TimerA, cycles);
    tick_timer(1U, 0x10U, 0x11U, 0x18U, 0x02U,
               Mn1271Irq::TimerB, cycles);
    tick_timer(2U, 0x12U, 0x13U, 0x18U, 0x04U,
               Mn1271Irq::TimerC, cycles);
    tick_timer(3U, 0x14U, 0x15U, 0x18U, 0x08U,
               Mn1271Irq::TimerD, cycles);
    tick_timer(4U, 0x16U, 0x17U, 0x08U, 0x10U,
               Mn1271Irq::TimerE, cycles);
    tick_timer(5U, 0x19U, 0x1aU, 0x08U, 0x20U,
               Mn1271Irq::TimerF, cycles);

    audio_numerator_ += static_cast<uint64_t>(cycles) * kPcmSampleRate;
    uint64_t frames = audio_numerator_ / kCpuClockHz;
    audio_numerator_ %= kCpuClockHz;
    while (frames != 0U) {
        pcm.push(next_pcm_frame());
        --frames;
    }
}

void Mn1271::set_cassette_input(bool high) noexcept
{
    cassette_input_ = high;
}

bool Mn1271::cassette_remote() const noexcept
{
    return cassette_remote_;
}

bool Mn1271::take_cassette_output(uint8_t& value) noexcept
{
    if (cassette_size_ == 0U) {
        return false;
    }
    value = cassette_output_[cassette_head_];
    cassette_head_ = (cassette_head_ + 1U) % kCassetteQueueCapacity;
    --cassette_size_;
    return true;
}

uint64_t Mn1271::cassette_output_dropped() const noexcept
{
    return cassette_dropped_;
}

bool Mn1271::take_read_activity() noexcept
{
    const bool value = read_activity_;
    read_activity_ = false;
    return value;
}

bool Mn1271::take_write_activity() noexcept
{
    const bool value = write_activity_;
    write_activity_ = false;
    return value;
}

bool Mn1271::irq_asserted() const noexcept
{
    return ((reg_[0x1cU] | reg_[0x1dU]) & 0x7fU) != 0U;
}

uint32_t Mn1271::prescale(uint8_t selector) noexcept
{
    switch (selector & 0x03U) {
    case 0U: return 1U;
    case 1U: return 8U;
    case 2U: return 64U;
    default: return 256U;
    }
}

void Mn1271::refresh_irq_flag() noexcept
{
    if (irq_asserted()) {
        reg_[0x1cU] = static_cast<uint8_t>(reg_[0x1cU] | kStatusAny);
        reg_[0x1dU] = static_cast<uint8_t>(reg_[0x1dU] | kStatusAny);
    } else {
        reg_[0x1cU] = static_cast<uint8_t>(reg_[0x1cU] & 0x7fU);
        reg_[0x1dU] = static_cast<uint8_t>(reg_[0x1dU] & 0x7fU);
    }
}

void Mn1271::set_irq_mask_1(uint8_t bit, bool enabled) noexcept
{
    const uint8_t mask = static_cast<uint8_t>(1U << bit);
    reg_[0x1eU] = static_cast<uint8_t>(reg_[0x1eU] & ~mask);
    if (enabled) {
        reg_[0x1eU] = static_cast<uint8_t>(reg_[0x1eU] | mask);
    }
}

void Mn1271::set_irq_mask_2(uint8_t bit, bool enabled) noexcept
{
    const uint8_t mask = static_cast<uint8_t>(1U << bit);
    reg_[0x1fU] = static_cast<uint8_t>(reg_[0x1fU] & ~mask);
    if (enabled) {
        reg_[0x1fU] = static_cast<uint8_t>(reg_[0x1fU] | mask);
    }
}

void Mn1271::write_irq_mask_1(uint8_t value) noexcept
{
    if ((value & 0x40U) != 0U) {
        reg_[0x0cU] = static_cast<uint8_t>(reg_[0x0cU] | kIrq);
    } else {
        reg_[0x0cU] = static_cast<uint8_t>(reg_[0x0cU] & ~kIrq);
    }
}

void Mn1271::write_irq_mask_2(uint8_t value) noexcept
{
    constexpr uint8_t controls[6]{0x0eU, 0x10U, 0x12U, 0x14U, 0x16U, 0x19U};
    for (uint8_t i = 0U; i < 6U; ++i) {
        const uint8_t mask = static_cast<uint8_t>(1U << i);
        if ((value & mask) != 0U) {
            reg_[controls[i]] = static_cast<uint8_t>(reg_[controls[i]] | kIrq);
        } else {
            reg_[controls[i]] = static_cast<uint8_t>(reg_[controls[i]] & ~kIrq);
        }
    }
}

void Mn1271::update_sound_frequency(uint8_t channel) noexcept
{
    uint8_t control = 0U;
    uint32_t count = 0U;
    if (channel == 0U) {
        control = reg_[0x12U];
        count = timer_set_[2];
    } else if (channel == 1U) {
        control = reg_[0x14U];
        count = timer_set_[3];
    } else {
        control = reg_[0x19U];
        count = timer_set_[5];
    }

    const uint8_t prescale_mask = channel == 2U ? 0x08U : 0x18U;
    const uint8_t selector = static_cast<uint8_t>(
        (control & prescale_mask) >> 3U);
    const uint64_t divider =
        static_cast<uint64_t>(count) * prescale(selector) * 2U;
    const uint32_t frequency = divider == 0U
        ? 0U
        : static_cast<uint32_t>(kCpuClockHz / divider);
    if (frequency >= 1U && frequency <= 15000U) {
        frequency_[channel] = frequency;
    } else {
        frequency_[channel] = 0U;
        playing_[channel] = false;
    }
}

void Mn1271::update_sound_control(uint8_t channel) noexcept
{
    const uint8_t control = channel == 0U
        ? reg_[0x12U]
        : (channel == 1U ? reg_[0x14U] : reg_[0x19U]);
    update_sound_frequency(channel);
    playing_[channel] =
        (control & 0x07U) == 0x06U && frequency_[channel] != 0U;
}

void Mn1271::tick_timer(
    uint8_t timer,
    uint8_t control_reg,
    uint8_t value_reg,
    uint8_t prescale_mask,
    uint8_t status_mask,
    Mn1271Irq irq,
    uint32_t cycles) noexcept
{
    if (!timer_enabled_[timer] || timer_set_[timer] == 0U) {
        return;
    }
    const uint8_t selector = static_cast<uint8_t>(
        (reg_[control_reg] & prescale_mask) >> 3U);
    const uint32_t scale = prescale(selector);
    const uint64_t period = static_cast<uint64_t>(timer_set_[timer]) * scale;
    const uint64_t total = timer_cycle_[timer] + cycles;
    if (total >= period) {
        reg_[control_reg] = static_cast<uint8_t>(reg_[control_reg] | kBorrow);
        assert_irq(irq);
    }
    timer_cycle_[timer] = total % period;
    const uint32_t elapsed = static_cast<uint32_t>(timer_cycle_[timer] / scale);
    const uint32_t remaining = timer_set_[timer] - elapsed;
    if (timer < 4U) {
        reg_[value_reg] = static_cast<uint8_t>(remaining & 0xffU);
    } else {
        reg_[value_reg] = static_cast<uint8_t>((remaining >> 8U) & 0xffU);
        reg_[static_cast<uint8_t>(value_reg + 1U)] =
            static_cast<uint8_t>(remaining & 0xffU);
    }
    if ((reg_[0x1dU] & status_mask) == 0U) {
        refresh_irq_flag();
    }
}

void Mn1271::push_cassette_output(uint8_t value) noexcept
{
    if (cassette_size_ == kCassetteQueueCapacity) {
        cassette_head_ = (cassette_head_ + 1U) % kCassetteQueueCapacity;
        --cassette_size_;
        ++cassette_dropped_;
    }
    const size_t tail = (cassette_head_ + cassette_size_) % kCassetteQueueCapacity;
    cassette_output_[tail] = value;
    ++cassette_size_;
}

PcmFrame Mn1271::next_pcm_frame() noexcept
{
    PcmFrame frame{};
    for (uint8_t channel = 0U; channel < 3U; ++channel) {
        if (playing_[channel] && frequency_[channel] != 0U) {
            frame.channel[channel] = phase_[channel] < (kPcmSampleRate / 2U)
                ? static_cast<int16_t>(7000)
                : static_cast<int16_t>(-7000);
            phase_[channel] = static_cast<uint32_t>(
                (static_cast<uint64_t>(phase_[channel]) + frequency_[channel]) %
                kPcmSampleRate);
        }
    }
    return frame;
}

void Mn1544::reset() noexcept
{
    scan_[0] = 0U;
    scan_[1] = 0xffU;
    scan_[2] = 0xffU;
    pointer_ = 0U;
    initialized_ = false;
    scanning_ = false;
    key_tested_ = false;
    previous_key_test_ = 0U;
    previous_previous_key_test_ = 0U;
    previous_key_ack_ = 0U;
    previous_previous_key_ack_ = 0U;
    current_key_ = 0U;
    joystick_[0] = 0xffU;
    joystick_[1] = 0xffU;
    irq_countdown_ = 0U;
    pending_code_ = 0U;
}

bool Mn1544::load_font(const uint8_t* data, size_t size) noexcept
{
    if (data == nullptr || size != kFontSize) {
        return false;
    }
    for (size_t i = 0U; i < kFontSize; ++i) {
        font_[i] = data[i];
    }
    font_[kFontSize] = 0U;
    return true;
}

void Mn1544::on_control_write(uint8_t value) noexcept
{
    constexpr uint8_t kKeyTest = 0x02U;
    constexpr uint8_t kKeyAck = 0x01U;
    const uint8_t key_test = static_cast<uint8_t>(value & kKeyTest);
    const uint8_t key_ack = static_cast<uint8_t>(value & kKeyAck);

    if (!initialized_) {
        if (previous_previous_key_test_ != 0U &&
            previous_key_test_ == 0U &&
            key_test != 0U &&
            !key_tested_) {
            key_tested_ = true;
            if (pointer_ <= kFontSize) {
                schedule_keycode(font_[pointer_]);
                ++pointer_;
            }
        } else if (previous_previous_key_ack_ != 0U &&
                   previous_key_ack_ == 0U &&
                   key_ack != 0U) {
            if (pointer_ <= kFontSize) {
                schedule_keycode(font_[pointer_]);
                ++pointer_;
            }
        }
        if (pointer_ == kFontSize + 1U) {
            initialized_ = true;
            key_tested_ = false;
            pointer_ = 0U;
        }
    } else {
        if (previous_previous_key_test_ != 0U &&
            previous_key_test_ == 0U &&
            key_test != 0U &&
            !scanning_) {
            begin_scan();
            scanning_ = true;
            schedule_keycode(scan_[pointer_]);
            ++pointer_;
        } else if (previous_previous_key_ack_ != 0U &&
                   previous_key_ack_ == 0U &&
                   key_ack != 0U &&
                   scanning_ && pointer_ < 3U) {
            schedule_keycode(scan_[pointer_]);
            ++pointer_;
        }
        if (pointer_ == 3U) {
            scanning_ = false;
            pointer_ = 0U;
        }
    }

    previous_previous_key_test_ = previous_key_test_;
    previous_key_test_ = key_test;
    previous_previous_key_ack_ = previous_key_ack_;
    previous_key_ack_ = key_ack;
}

void Mn1544::set_key_state(uint8_t code, bool pressed) noexcept
{
    if (pressed) {
        current_key_ = code;
        if (code != 0U) {
            schedule_keycode(code);
        }
    } else if (current_key_ == code) {
        current_key_ = 0U;
    }
}

void Mn1544::set_joystick(
    uint8_t player,
    uint8_t active_low_state) noexcept
{
    if (player < 2U) {
        joystick_[player] = active_low_state;
    }
}

void Mn1544::tick(uint32_t cycles, Mn1271& io) noexcept
{
    if (irq_countdown_ == 0U) {
        return;
    }
    if (cycles < irq_countdown_) {
        irq_countdown_ -= cycles;
        return;
    }
    io.io_write(0x01U, pending_code_);
    io.assert_irq(Mn1271Irq::KeyOn);
    irq_countdown_ = 0U;
    pending_code_ = 0U;
}

bool Mn1544::initialized() const noexcept
{
    return initialized_;
}

uint16_t Mn1544::bootstrap_pointer() const noexcept
{
    return pointer_;
}

uint8_t Mn1544::current_key() const noexcept
{
    return current_key_;
}

void Mn1544::schedule_keycode(uint8_t code) noexcept
{
    pending_code_ = code;
    irq_countdown_ = kIrqDelayCycles;
}

void Mn1544::begin_scan() noexcept
{
    scan_[0] = current_key_;
    scan_[1] = joystick_[0];
    scan_[2] = joystick_[1];
}

void Crtc::reset() noexcept
{
    border_color_ = 0U;
    scan_value_ = 0U;
    scan_cycle_ = 0U;
    frame_generation_ = 0U;
    for (size_t i = 0U; i < kFramebufferPixels; ++i) {
        framebuffer_[i] = kColors[0];
    }
}

uint8_t Crtc::read(uint16_t reg) const noexcept
{
    (void)reg;
    return scan_value_;
}

uint8_t Crtc::peek(uint16_t reg) const noexcept
{
    (void)reg;
    return scan_value_;
}

void Crtc::write(uint16_t reg, uint8_t value) noexcept
{
    (void)reg;
    border_color_ = static_cast<uint8_t>(value & 0x07U);
}

void Crtc::tick(uint32_t cycles, const uint8_t* memory) noexcept
{
    if (memory == nullptr) {
        return;
    }
    constexpr uint32_t kScanPeriod = 1152U;
    const uint32_t phase =
        (static_cast<uint32_t>(scan_cycle_) + (cycles % kScanPeriod)) %
        kScanPeriod;
    scan_cycle_ = static_cast<uint16_t>(phase);
    const uint16_t offset = static_cast<uint16_t>((2U * phase) / 3U);
    scan_value_ = memory[static_cast<uint16_t>(0xc500U + offset)];
}

void Crtc::render(const uint8_t* memory) noexcept
{
    if (memory == nullptr) {
        return;
    }
    for (size_t i = 0U; i < kFramebufferPixels; ++i) {
        framebuffer_[i] = kColors[border_color_];
    }

    for (size_t x = 0U; x < 32U; ++x) {
        for (size_t y = 0U; y < 24U; ++y) {
            const size_t cell = x + y * 32U;
            const uint8_t character = memory[0xc100U + cell];
            const uint8_t raw_attribute = memory[0xc500U + cell];
            const uint8_t mode = static_cast<uint8_t>(raw_attribute & 0xc0U);
            const uint8_t attribute = static_cast<uint8_t>(raw_attribute & 0x3fU);
            const size_t pixel_x = x * 8U + 32U;
            const size_t pixel_y = y * 8U + 16U;

            if (mode == 0x00U || mode == 0x40U) {
                const uint8_t foreground = static_cast<uint8_t>(attribute & 0x07U);
                const uint8_t background = static_cast<uint8_t>((attribute >> 3U) & 0x07U);
                const size_t font_base = (mode == 0x00U ? 0xd000U : 0xc000U) +
                    static_cast<size_t>(character) * 8U;
                for (size_t row = 0U; row < 8U; ++row) {
                    const uint8_t face = memory[font_base + row];
                    for (size_t column = 0U; column < 8U; ++column) {
                        const bool set = (face & static_cast<uint8_t>(0x80U >> column)) != 0U;
                        const size_t pixel =
                            pixel_x + column + (pixel_y + row) * kFramebufferWidth;
                        framebuffer_[pixel] = kColors[set ? foreground : background];
                    }
                }
            } else {
                const uint8_t upper_right = static_cast<uint8_t>((character >> 3U) & 0x07U);
                const uint8_t upper_left = static_cast<uint8_t>(character & 0x07U);
                const uint8_t lower_right = static_cast<uint8_t>((attribute >> 3U) & 0x07U);
                const uint8_t lower_left = static_cast<uint8_t>(attribute & 0x07U);
                for (size_t row = 0U; row < 8U; ++row) {
                    for (size_t column = 0U; column < 8U; ++column) {
                        const bool lower = row >= 4U;
                        const bool right = column >= 4U;
                        const uint8_t color = lower
                            ? (right ? lower_right : lower_left)
                            : (right ? upper_right : upper_left);
                        const size_t pixel =
                            pixel_x + column + (pixel_y + row) * kFramebufferWidth;
                        framebuffer_[pixel] = kColors[color];
                    }
                }
            }
        }
    }
    ++frame_generation_;
}

const uint32_t* Crtc::framebuffer() const noexcept
{
    return framebuffer_;
}

uint32_t* Crtc::framebuffer() noexcept
{
    return framebuffer_;
}

uint64_t Crtc::frame_generation() const noexcept
{
    return frame_generation_;
}

uint8_t Crtc::border_color() const noexcept
{
    return border_color_;
}

}  // namespace jr200
